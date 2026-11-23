const { mongoose } = require('../utils/db');
const campusModel = require('../models/campusModel');
const loanModel = require('../models/loanModel');
const chargeModel = require('../models/chargeModel');
const librarySettingsModel = require('../models/librarySettingsModel');
const { Book, BookCopy, Student, Payment } = require('../models/schemas');
const paymentModel = require('../models/paymentModel');
const waiverModel = require('../models/waiverModel');
const bookCopyModel = require('../models/bookCopyModel');
const svc = require('../services/circulationService');
const fine = require('../services/fineService');
const { assertCampusAccess, campusFilter } = require('../middleware/libraryScope');
const { logAudit, logAuditMany, logError } = require('../utils/audit');
const { cleanOptionalText } = require('../utils/fineValidation');
const { ok, created, badRequest, forbidden, notFound } = require('../views/response');

const ObjectId = mongoose.Types.ObjectId;
const BACKDATE_WINDOW_DAYS = 30;
const CLOCK_SKEW_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isBlank = (v) => v === undefined || v === null || v === '';
const rupee = (n) => `₹${svc.money(n)}`;

function deny(req, res, what) {
  logError(req, 403, `Library user attempted to access another campus's ${what} - ${req.method} ${req.originalUrl}`);
  return forbidden(res, 'You can only manage your own campus');
}

// Same campus resolution rules as the catalog controller. { campus } | { fail(res) }.
async function resolveCampus(req, rawCampusId, { required = true } = {}) {
  if (!req.library.isAdmin) {
    if (!isBlank(rawCampusId) && (typeof rawCampusId !== 'string' || !assertCampusAccess(req, rawCampusId))) {
      return { fail: (res) => deny(req, res, 'circulation desk') };
    }
    const own = await campusModel.findById(req.library.campusId);
    if (!own || !own.isActive) return { fail: (res) => forbidden(res, 'Library access denied') };
    return { campus: own };
  }
  if (isBlank(rawCampusId)) {
    return required ? { fail: (res) => badRequest(res, 'Campus is required') } : { campus: null };
  }
  if (typeof rawCampusId !== 'string' || !mongoose.isValidObjectId(rawCampusId)) {
    return { fail: (res) => badRequest(res, 'Invalid campus') };
  }
  const campus = await campusModel.findById(rawCampusId);
  if (!campus || !campus.isActive) return { fail: (res) => notFound(res, 'Campus not found') };
  return { campus };
}

// Read scope: non-admin -> own campus; admin -> optional campusId filter (omit = all).
function readScope(req, campusId) {
  if (campusId !== undefined && typeof campusId !== 'string') return { error: 'Invalid campus' };
  if (req.library.isAdmin) {
    if (!campusId) return { scope: {} };
    if (!mongoose.isValidObjectId(campusId)) return { error: 'Invalid campus' };
    return { scope: { campusId: new ObjectId(campusId) } };
  }
  if (campusId && !assertCampusAccess(req, campusId)) return { denied: true };
  return { scope: campusFilter(req) };
}

const cleanReg = (v) => {
  if (typeof v !== 'string') return { error: 'Reg Number is required' };
  const s = v.trim();
  if (!s) return { error: 'Reg Number is required' };
  if (s.length > 50) return { error: 'Reg Number is too long' };
  return { value: s };
};

// Catalog numbers are stored upper-case (campus code is upper-case).
const cleanCatalogNumber = (v) => {
  if (typeof v !== 'string' || !v.trim()) return { error: 'Catalog number is required' };
  const s = v.trim().toUpperCase();
  if (s.length > 40) return { error: 'Catalog number is too long' };
  return { value: s };
};

const cleanReason = (v) => {
  if (typeof v !== 'string' || !v.trim()) return { error: 'A reason is required when backdating' };
  const s = v.trim();
  if (s.length > 300) return { error: 'Reason must be 300 characters or fewer' };
  return { value: s };
};

// Optional money value (>= 0, <= 2 decimals). Blank -> { value: undefined }.
function cleanMoney(v, label) {
  if (isBlank(v)) return { value: undefined };
  let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) n = Number(v.trim());
  if (!Number.isFinite(n) || n < 0) return { error: `${label} must be a number ≥ 0` };
  if (n > 10000000) return { error: `${label} is too large` };
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { error: `${label} can have at most 2 decimal places` };
  return { value: fine.round2(n) };
}

// Backdate timestamp: ISO string, <= now (small clock skew tolerated, then clamped), >= now - 30 days.
function cleanBackdate(v, label) {
  if (typeof v !== 'string' || !v.trim()) return { error: `Invalid ${label} date` };
  const d = new Date(v.trim());
  if (Number.isNaN(d.getTime())) return { error: `Invalid ${label} date` };
  const now = Date.now();
  if (d.getTime() > now + CLOCK_SKEW_MS) return { error: `${label} date cannot be in the future` };
  if (d.getTime() < now - BACKDATE_WINDOW_DAYS * 86400000) {
    return { error: `${label} date can be at most ${BACKDATE_WINDOW_DAYS} days in the past` };
  }
  return { value: d.getTime() > now ? new Date(now) : d };
}

// Resolves optional (timestamp, reason) backdating inputs. { value: { at, reason } | null } | { error } | { forbidden }.
function resolveBackdating(req, rawAt, rawReason, label) {
  if (isBlank(rawAt)) return { value: null };
  if (!req.library.isAdmin) return { forbidden: true };
  const at = cleanBackdate(rawAt, label);
  if (at.error) return at;
  const reason = cleanReason(rawReason);
  if (reason.error) return reason;
  return { value: { at: at.value, reason: reason.value } };
}

function failure(res, err, { withReasons = false } = {}) {
  if (err && err.name === 'CirculationError') {
    return res.status(400).json({
      success: false,
      message: err.message,
      ...(withReasons ? { data: { reasons: err.reasons } } : {}),
    });
  }
  throw err;
}

const forbidBackdate = (req, res) => {
  logError(req, 403, `Non-admin attempted to backdate - ${req.method} ${req.originalUrl}`);
  return forbidden(res, 'Only an administrator can backdate');
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function studentCard(req, res) {
  const reg = cleanReg(req.params.regNumber);
  if (reg.error) return badRequest(res, reg.error);
  const r = await resolveCampus(req, req.query.campusId);
  if (r.fail) return r.fail(res);

  const found = await svc.findStudentByReg(reg.value);
  if (!found) return notFound(res, 'No student with this Reg Number');
  const ledger = await svc.loadLedger(found.student._id);
  if (!req.library.isAdmin) {
    const visible = await svc.canStaffSeeStudent({
      campusId: found.campusId, ledger, studentId: found.student._id, ownCampusId: req.library.campusId,
    });
    if (!visible) return notFound(res, 'No student with this Reg Number');
  }
  const settings = await librarySettingsModel.get();
  const card = await svc.buildStudentCard({ ...found, deskCampus: r.campus, ledger, settings });
  return ok(res, card);
}

async function copyCard(req, res) {
  const cn = cleanCatalogNumber(req.params.catalogNumber);
  if (cn.error) return badRequest(res, cn.error);
  const s = readScope(req, req.query.campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'copy');

  const copy = await BookCopy.findOne({ ...s.scope, catalogNumber: cn.value }).lean();
  if (!copy) return notFound(res, 'No copy with this catalog number');
  const settings = await librarySettingsModel.get();
  const [shaped] = await bookCopyModel.shapeMany([copy]);
  await loanModel.attachLoanInfo([shaped]);
  const [book, campuses, openLoan] = await Promise.all([
    Book.findById(copy.bookId).select('title author price').lean(),
    campusModel.summariesByIds([copy.campusId]),
    copy.status === 'ISSUED' ? loanModel.findOpenByCopy(copy._id) : null,
  ]);
  const [loanView] = openLoan ? await loanModel.shapeMany([openLoan], { settings }) : [null];
  return ok(res, {
    copy: shaped,
    book: { id: String(copy.bookId), title: book?.title || '', author: book?.author || '', price: book?.price ?? null },
    campus: campuses.get(String(copy.campusId)) || null,
    openLoan: loanView || null,
  });
}

async function listLoans(req, res) {
  const { view, campusId, q } = req.query;
  if (!['open', 'overdue', 'dueToday', 'dueSoon'].includes(view)) return badRequest(res, 'Invalid view');
  if (q !== undefined && typeof q !== 'string') return badRequest(res, 'Invalid q');
  const s = readScope(req, campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'loans');

  const page = Math.min(10000, Math.max(1, parseInt(req.query.page, 10) || 1));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const now = new Date();
  const [settings, { docs, total }] = await Promise.all([
    librarySettingsModel.get(),
    loanModel.listOpen({ scope: s.scope, view, q: (q || '').trim().slice(0, 100), page, limit, now }),
  ]);
  const items = await loanModel.shapeMany(docs, { settings, now });
  return ok(res, { items, total, page, limit });
}

async function studentHistory(req, res) {
  const { studentId } = req.params;
  if (!mongoose.isValidObjectId(studentId)) return notFound(res, 'Student not found');
  const found = await svc.findStudentById(studentId);
  if (!found) return notFound(res, 'Student not found');

  const ledger = await svc.loadLedger(found.student._id);
  const isAdmin = req.library.isAdmin;
  if (!isAdmin) {
    const visible = await svc.canStaffSeeStudent({
      campusId: found.campusId, ledger, studentId: found.student._id,
      ownCampusId: req.library.campusId, includeHistory: true,
    });
    if (!visible) return notFound(res, 'Student not found');
  }

  const scope = campusFilter(req);
  const now = new Date();
  const [settings, loanDocs, chargeDocs, paymentDocs, waiverDocs, campuses] = await Promise.all([
    librarySettingsModel.get(),
    loanModel.findByStudent(found.student._id, scope),
    chargeModel.findByStudent(found.student._id, scope),
    Payment.find({ studentId: found.student._id, ...scope }).sort({ receivedAt: -1, _id: -1 }).limit(500).lean(),
    waiverModel.findByStudent(found.student._id, scope),
    campusModel.summariesByIds(found.campusId ? [found.campusId] : []),
  ]);
  const [loans, charges, payments, waivers] = await Promise.all([
    loanModel.shapeMany(loanDocs, { settings, now }),
    chargeModel.shapeMany(chargeDocs),
    paymentModel.shapeMany(paymentDocs),
    waiverModel.shapeMany(waiverDocs),
  ]);

  let otherCampuses = null;
  if (!isAdmin) {
    const summary = svc.summarizeLedger(ledger, now);
    otherCampuses = svc.otherCampusSummary(summary, req.library.campusId, await svc.codesFor(summary, req.library.campusId));
  }
  return ok(res, {
    student: svc.shapeStudent(found.student, found.batch, campuses.get(found.campusId) || null),
    loans,
    charges,
    payments,
    waivers,
    otherCampuses,
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function issue(req, res) {
  const body = req.body || {};
  const reg = cleanReg(body.regNumber);
  if (reg.error) return badRequest(res, reg.error);
  const cn = cleanCatalogNumber(body.catalogNumber);
  if (cn.error) return badRequest(res, cn.error);
  const r = await resolveCampus(req, body.campusId);
  if (r.fail) return r.fail(res);
  const { campus } = r;

  const bd = resolveBackdating(req, body.issuedAt, body.reason, 'Issue');
  if (bd.forbidden) return forbidBackdate(req, res);
  if (bd.error) return badRequest(res, bd.error);

  const settings = await librarySettingsModel.get();
  const [found, copy] = await Promise.all([
    svc.findStudentByReg(reg.value),
    BookCopy.findOne({ campusId: new ObjectId(campus.id), catalogNumber: cn.value }).lean(),
  ]);

  // Student the caller may not even see is reported as not found (no cross-campus leak).
  let ledger = { openLoans: [], charges: [] };
  let student = found;
  if (found) {
    ledger = await svc.loadLedger(found.student._id);
    if (!req.library.isAdmin) {
      const visible = await svc.canStaffSeeStudent({
        campusId: found.campusId, ledger, studentId: found.student._id, ownCampusId: req.library.campusId,
      });
      if (!visible) student = null;
    }
  }

  const now = new Date();
  const reasons = student
    ? svc.evaluateEligibility({
      student: student.student, studentCampusId: student.campusId, deskCampus: campus, ledger,
      summary: svc.summarizeLedger(ledger, now), settings,
    })
    : svc.evaluateEligibility({ student: null });
  const openLoanOfCopy = copy && copy.status === 'ISSUED' ? await loanModel.findOpenByCopy(copy._id) : null;
  const cr = svc.copyReason(copy, campus, openLoanOfCopy);
  if (cr) reasons.push(cr);
  if (reasons.length) {
    return res.status(400).json({ success: false, message: reasons[0].message, data: { reasons } });
  }

  let loan;
  try {
    loan = await svc.issueLoan({
      student: student.student, copy, settings, userId: req.user.id,
      issuedAt: bd.value ? bd.value.at : null, backdateReason: bd.value ? bd.value.reason : null,
    });
  } catch (err) {
    return failure(res, err, { withReasons: true });
  }

  // ---- committed: from here on NEVER return an error ----
  let title = '';
  try {
    title = (await Book.findById(copy.bookId).select('title').lean())?.title || '';
  } catch (err) { console.error('[circulation] post-issue title lookup', err.message); }
  await logAudit(req, 'CREATE', 'Loan', String(loan._id),
    `Issued ${copy.catalogNumber} "${title}" to ${student.student.regNumber} (${student.student.fullName}), due ${loan.dueDate}`
    + (bd.value ? ` — backdated to ${fine.istDate(loan.issuedAt)}, reason: ${bd.value.reason}` : ''));

  try {
    const freshLedger = await svc.loadLedger(student.student._id);
    const [loanView] = await loanModel.shapeMany([loan], { settings });
    const card = await svc.buildStudentCard({ ...student, deskCampus: campus, ledger: freshLedger, settings });
    return created(res, { loan: loanView, student: card });
  } catch (err) {
    console.error('[circulation] post-issue response build', err);
    return created(res, {
      loan: { id: String(loan._id), dueDate: loan.dueDate, status: loan.status, issuedAt: loan.issuedAt, copy: { catalogNumber: copy.catalogNumber } },
      student: null,
    }, 'Issued — refresh to see the student card');
  }
}

async function returnBook(req, res) {
  const body = req.body || {};
  const cn = cleanCatalogNumber(body.catalogNumber);
  if (cn.error) return badRequest(res, cn.error);
  if (body.condition !== 'GOOD' && body.condition !== 'DAMAGED') return badRequest(res, 'Condition must be GOOD or DAMAGED');

  let severity = null;
  if (body.condition === 'DAMAGED') {
    if (body.severity !== 'MINOR' && body.severity !== 'MAJOR') return badRequest(res, 'Severity must be MINOR or MAJOR');
    severity = body.severity;
  } else if (!isBlank(body.severity)) {
    return badRequest(res, 'Severity applies only to damaged books');
  }
  const chargeIn = cleanMoney(body.charge, 'Charge');
  if (chargeIn.error) return badRequest(res, chargeIn.error);
  if (body.condition === 'GOOD' && chargeIn.value) return badRequest(res, 'A damage charge applies only to damaged books');
  if (body.condition === 'DAMAGED' && severity === 'MINOR' && chargeIn.value === undefined) {
    return badRequest(res, 'Enter the damage charge');
  }

  const bd = resolveBackdating(req, body.returnedAt, body.reason, 'Return');
  if (bd.forbidden) return forbidBackdate(req, res);
  if (bd.error) return badRequest(res, bd.error);

  const s = readScope(req, body.campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'copy');
  const copy = await BookCopy.findOne({ ...s.scope, catalogNumber: cn.value }).lean();
  if (!copy) return notFound(res, 'No copy with this catalog number');
  const openLoan = await loanModel.findOpenByCopy(copy._id);
  if (!openLoan) return badRequest(res, `Copy ${copy.catalogNumber} is not currently issued`);
  if (!assertCampusAccess(req, openLoan.campusId)) return deny(req, res, 'loan');

  let out;
  try {
    out = await svc.returnLoan({
      loanId: openLoan._id, userId: req.user.id, condition: body.condition, severity, charge: chargeIn.value,
      returnedAt: bd.value ? bd.value.at : null, backdateReason: bd.value ? bd.value.reason : null,
    });
  } catch (err) {
    return failure(res, err);
  }

  // ---- committed: from here on NEVER return an error ----
  let settings = null;
  let stu = null;
  try {
    [settings, stu] = await Promise.all([
      librarySettingsModel.get(),
      Student.findById(out.loan.studentId).select('fullName regNumber').lean(),
    ]);
  } catch (err) { console.error('[circulation] post-return lookups', err.message); }
  const who = `${stu?.regNumber || ''} (${stu?.fullName || ''})`;
  const title = out.book?.title || '';
  const parts = [
    `Returned ${copy.catalogNumber} "${title}" from ${who}`,
    out.daysLate > 0
      ? `${out.daysLate} day${out.daysLate === 1 ? '' : 's'} late`
        + (out.waivedDays > 0 ? ` (${out.waivedDays} no-fine day${out.waivedDays === 1 ? '' : 's'} excluded)` : '')
        + `, fine ${rupee(out.lateAmount)}`
      : 'on time',
  ];
  if (out.loan.condition !== 'GOOD') {
    const major = out.loan.condition === 'DAMAGED_MAJOR';
    const copyNote = out.copyDriftStatus ? '' : `, copy ${major ? 'withdrawn' : 'marked damaged'}`;
    parts.push(`damaged (${major ? 'major' : 'minor'}), charge ${rupee(out.damageAmount)}${copyNote}`);
  }
  if (bd.value) parts.push(`backdated to ${fine.istDate(out.loan.returnedAt)}, reason: ${bd.value.reason}`);
  let description = parts.join(', ');
  if (out.copyDriftStatus) description += ` (copy status was ${out.copyDriftStatus} — not changed)`;

  const entries = [{ action: 'UPDATE', entity: 'Loan', entityId: out.loan._id, description }];
  for (const c of out.charges) {
    entries.push({
      action: 'CREATE', entity: 'Charge', entityId: c._id,
      description: `${c.type === 'LATE' ? 'Late fine' : 'Damage charge'} ${rupee(c.amount)} on ${who} for ${copy.catalogNumber} "${title}"`,
    });
  }
  await logAuditMany(req, entries);

  try {
    const ledger = await svc.loadLedger(out.loan.studentId);
    const total = svc.summarizeLedger(ledger).total;
    const [[loanView], chargeViews] = await Promise.all([
      loanModel.shapeMany([out.loan], { settings }),
      chargeModel.shapeMany(out.charges),
    ]);
    return ok(res, {
      loan: loanView,
      charges: chargeViews,
      student: { id: String(out.loan.studentId), fullName: stu?.fullName || '', regNumber: stu?.regNumber || '', outstanding: total },
    });
  } catch (err) {
    console.error('[circulation] post-return response build', err);
    return ok(res, {
      loan: { id: String(out.loan._id), status: out.loan.status, returnedAt: out.loan.returnedAt, condition: out.loan.condition, copy: { catalogNumber: copy.catalogNumber } },
      charges: out.charges.map((c) => ({ id: String(c._id), type: c.type, amount: c.amount, status: c.status })),
      student: null,
    }, 'Returned — refresh to see updated details');
  }
}

async function reportLost(req, res) {
  const body = req.body || {};
  if (typeof body.loanId !== 'string' || !mongoose.isValidObjectId(body.loanId)) return badRequest(res, 'Invalid loan');
  const amountIn = cleanMoney(body.amount, 'Amount');
  if (amountIn.error) return badRequest(res, amountIn.error);
  const note = cleanOptionalText(body.note, 'Note', 500);
  if (note.error) return badRequest(res, note.error);
  const bd = resolveBackdating(req, body.lostAt, body.reason, 'Lost');
  if (bd.forbidden) return forbidBackdate(req, res);
  if (bd.error) return badRequest(res, bd.error);

  const loan = await loanModel.findById(body.loanId);
  if (!loan) return notFound(res, 'Loan not found');
  if (!assertCampusAccess(req, loan.campusId)) return deny(req, res, 'loan');
  if (loan.status !== 'OPEN') return badRequest(res, 'This loan is already closed');

  let out;
  try {
    out = await svc.reportLost({
      loanId: loan._id, userId: req.user.id, amount: amountIn.value, note: note.value,
      lostAt: bd.value ? bd.value.at : null, backdateReason: bd.value ? bd.value.reason : null,
    });
  } catch (err) {
    return failure(res, err);
  }

  // ---- committed: from here on NEVER return an error ----
  let settings = null;
  let stu = null;
  let catalogNumber = '';
  try {
    [settings, stu] = await Promise.all([
      librarySettingsModel.get(),
      Student.findById(out.loan.studentId).select('fullName regNumber').lean(),
    ]);
    catalogNumber = (await BookCopy.findById(out.loan.copyId).select('catalogNumber').lean())?.catalogNumber || '';
  } catch (err) { console.error('[circulation] post-lost lookups', err.message); }
  const who = `${stu?.regNumber || ''} (${stu?.fullName || ''})`;
  const title = out.book?.title || '';
  let description = `Reported lost ${catalogNumber} "${title}" by ${who} — late fine ${rupee(out.lateAmount)}, lost charge ${rupee(out.lostAmount)}`;
  if (note.value) description += `, note: ${note.value}`;
  if (bd.value) description += `, backdated to ${fine.istDate(out.loan.lostAt)}, reason: ${bd.value.reason}`;
  if (out.copyDriftStatus) description += ` (copy status was ${out.copyDriftStatus} — not changed)`;

  const entries = [{ action: 'UPDATE', entity: 'Loan', entityId: out.loan._id, description }];
  for (const c of out.charges) {
    entries.push({
      action: 'CREATE', entity: 'Charge', entityId: c._id,
      description: `${c.type === 'LATE' ? 'Late fine' : 'Lost-book charge'} ${rupee(c.amount)} on ${who} for ${catalogNumber} "${title}"`,
    });
  }
  await logAuditMany(req, entries);

  try {
    const ledger = await svc.loadLedger(out.loan.studentId);
    const total = svc.summarizeLedger(ledger).total;
    const [[loanView], chargeViews] = await Promise.all([
      loanModel.shapeMany([out.loan], { settings }),
      chargeModel.shapeMany(out.charges),
    ]);
    return ok(res, {
      loan: loanView,
      charges: chargeViews,
      student: { id: String(out.loan.studentId), fullName: stu?.fullName || '', regNumber: stu?.regNumber || '', outstanding: total },
      copyDriftStatus: out.copyDriftStatus,
    });
  } catch (err) {
    console.error('[circulation] post-lost response build', err);
    return ok(res, {
      loan: { id: String(out.loan._id), status: out.loan.status, lostAt: out.loan.lostAt, copy: { catalogNumber } },
      charges: out.charges.map((c) => ({ id: String(c._id), type: c.type, amount: c.amount, status: c.status })),
      student: null,
      copyDriftStatus: out.copyDriftStatus,
    }, 'Reported lost — refresh to see updated details');
  }
}

async function renew(req, res) {
  const { loanId } = req.body || {};
  if (typeof loanId !== 'string' || !mongoose.isValidObjectId(loanId)) return badRequest(res, 'Invalid loan');
  const loan = await loanModel.findById(loanId);
  if (!loan) return notFound(res, 'Loan not found');
  if (!assertCampusAccess(req, loan.campusId)) return deny(req, res, 'loan');

  const settings = await librarySettingsModel.get();
  let result;
  try {
    result = await svc.renewLoan({ loanId: loan._id, userId: req.user.id, settings });
  } catch (err) {
    return failure(res, err);
  }
  if (!result) return notFound(res, 'Loan not found');

  // ---- committed: from here on NEVER return an error ----
  let view = null;
  try {
    [view] = await loanModel.shapeMany([result.loan], { settings });
  } catch (err) { console.error('[circulation] post-renew view build', err); }
  const what = view
    ? `${view.copy.catalogNumber} "${view.book.title}" for ${view.student.regNumber} (${view.student.fullName})`
    : `loan ${loan._id}`;
  await logAudit(req, 'UPDATE', 'Loan', String(loan._id),
    `Renewed ${what} — due ${result.previousDueDate} → ${result.newDueDate}`);
  if (view) return ok(res, { loan: view });
  return ok(res, {
    loan: { id: String(loan._id), dueDate: result.newDueDate, renewCount: result.loan.renewCount, status: result.loan.status },
  }, 'Renewed — refresh to see the loan');
}

module.exports = {
  studentCard, copyCard, listLoans, studentHistory, issue, returnBook, reportLost, renew,
  // shared with finesController (same campus-scoping rules)
  resolveCampus, readScope, deny, failure, isBlank, rupee, cleanReg,
};
