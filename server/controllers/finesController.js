// Library Phase 4: pending fines, payments, waivers and no-fine periods.
// Scoping: non-admins act only on their own campus (verified against the charge's / payment's
// campus); ADMIN-only routes are enforced here. Every write follows the same shape:
// validate -> service (transaction) -> audit (awaited) -> build the response in try/catch.
const { mongoose } = require('../utils/db');
const campusModel = require('../models/campusModel');
const chargeModel = require('../models/chargeModel');
const loanModel = require('../models/loanModel');
const paymentModel = require('../models/paymentModel');
const waiverModel = require('../models/waiverModel');
const finePeriodModel = require('../models/finePeriodModel');
const librarySettingsModel = require('../models/librarySettingsModel');
const {
  Charge, Loan, Payment, Waiver, Student, Batch, User, BookCopy, WAIVER_STATUSES, containsInsensitive,
} = require('../models/schemas');
const svc = require('../services/circulationService');
const fine = require('../services/fineService');
const paymentService = require('../services/paymentService');
const waiverService = require('../services/waiverService');
const finePeriodService = require('../services/finePeriodService');
const finePending = require('../services/finePendingService');
const { dayRange } = finePending;
const { assertCampusAccess } = require('../middleware/libraryScope');
const {
  cleanObjectId, cleanPositiveMoney, cleanRequiredText, cleanOptionalText, cleanYmd, cleanDateRange,
  validateAllocations, cleanRequestId, cleanBool, todayIst,
} = require('../utils/fineValidation');
const { logAudit, logAuditMany, logError } = require('../utils/audit');
const { ok, created, badRequest, forbidden, notFound } = require('../views/response');
const { resolveCampus, readScope, deny, failure, isBlank, rupee } = require('./circulationController');

const ObjectId = mongoose.Types.ObjectId;
const OPEN_STATUSES = ['UNPAID', 'PARTIAL'];

const pageOf = (req) => ({
  page: Math.min(10000, Math.max(1, parseInt(req.query.page, 10) || 1)),
  limit: Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25)),
});

function requireAdmin(req, res, what) {
  if (req.library.isAdmin) return true;
  logError(req, 403, `Non-admin attempted to ${what} - ${req.method} ${req.originalUrl}`);
  forbidden(res, 'Only an administrator can do this');
  return false;
}

// "CAT-NUMBER" for a charge (falls back to its type), looked up once.
async function chargeLabel(charge) {
  try {
    const copy = await BookCopy.findById(charge.copyId).select('catalogNumber').lean();
    return `${charge.type} charge ${copy?.catalogNumber || ''}`.trim();
  } catch (err) {
    console.error('[fines] label lookup', err.message);
    return `${charge.type} charge`;
  }
}

// ---------------------------------------------------------------------------
// Pending fines
// ---------------------------------------------------------------------------

async function pending(req, res) {
  const { q } = req.query;
  if (q !== undefined && typeof q !== 'string') return badRequest(res, 'Invalid q');
  const s = readScope(req, req.query.campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'fines');
  const { page, limit } = pageOf(req);

  let studentFilter = {};
  const term = (q || '').trim().slice(0, 100);
  if (term) {
    const rx = containsInsensitive(term);
    // Search only among students who can appear in this list (open charge or open loan in scope),
    // so a broad term never truncates the result and totals stay exact.
    const [withCharges, withLoans] = await Promise.all([
      Charge.distinct('studentId', { ...s.scope, status: { $in: finePending.OPEN_STATUSES } }),
      Loan.distinct('studentId', { ...s.scope, status: 'OPEN' }),
    ]);
    const candidates = [...new Map([...withCharges, ...withLoans].map((id) => [String(id), id])).values()];
    const found = candidates.length === 0 ? [] : await Student.find({
      _id: { $in: candidates }, $or: [{ regNumber: rx }, { fullName: rx }],
    }).select('_id').lean();
    if (found.length === 0) return ok(res, { items: [], total: 0, page, limit, totals: { balance: 0, accruing: 0 } });
    studentFilter = { studentId: { $in: found.map((f) => f._id) } };
  }

  const { rows: rowsAll, totals } = await finePending.pendingRows({ scope: s.scope, studentFilter });

  const slice = rowsAll.slice((page - 1) * limit, page * limit);
  const students = await Student.find({ _id: { $in: slice.map((r) => r.studentId) } })
    .select('fullName regNumber batchId isActive').lean();
  const [batches, campuses] = await Promise.all([
    Batch.find({ _id: { $in: students.map((st) => st.batchId) } }).select('name').lean(),
    campusModel.summariesByIds(slice.map((r) => r.campusId)),
  ]);
  const stById = new Map(students.map((st) => [String(st._id), st]));
  const batchById = new Map(batches.map((b) => [String(b._id), { id: String(b._id), name: b.name }]));
  const items = slice.map((r) => {
    const st = stById.get(r.studentId);
    return {
      student: {
        id: r.studentId, fullName: st?.fullName || '', regNumber: st?.regNumber || '',
        batch: st ? batchById.get(String(st.batchId)) || null : null, isActive: !!st?.isActive,
      },
      campus: campuses.get(r.campusId) || null,
      balance: r.balance, chargeCount: r.chargeCount, oldestChargeAt: r.oldestChargeAt, accruing: r.accruing,
    };
  });
  return ok(res, { items, total: rowsAll.length, page, limit, totals });
}

async function studentFines(req, res) {
  const id = cleanObjectId(req.params.studentId, 'student');
  if (id.error) return notFound(res, 'Student not found');
  const r = await resolveCampus(req, req.query.campusId);
  if (r.fail) return r.fail(res);
  const campusId = new ObjectId(String(r.campus.id));

  const found = await svc.findStudentById(id.value);
  if (!found) return notFound(res, 'Student not found');
  if (!req.library.isAdmin) {
    const ledger = await svc.loadLedger(found.student._id);
    const visible = await svc.canStaffSeeStudent({
      campusId: found.campusId, ledger, studentId: found.student._id, ownCampusId: req.library.campusId, includeHistory: true,
    });
    if (!visible) return notFound(res, 'Student not found');
  }

  const today = todayIst();
  const [settings, chargeDocs, loanDocs, campuses] = await Promise.all([
    librarySettingsModel.get(),
    Charge.find({ studentId: found.student._id, campusId, status: { $in: OPEN_STATUSES } }).sort({ createdAt: 1, _id: 1 }).lean(),
    Loan.find({ studentId: found.student._id, campusId, status: 'OPEN', dueDate: { $lt: today } }).sort({ dueDate: 1, _id: 1 }).lean(),
    campusModel.summariesByIds(found.campusId ? [found.campusId] : []),
  ]);
  const owing = chargeDocs.filter((c) => chargeModel.balanceOf(c) > 0);
  const [charges, accruing] = await Promise.all([
    chargeModel.shapeMany(owing),
    loanModel.shapeMany(loanDocs, { settings }),
  ]);
  const balance = owing.reduce((t, c) => fine.round2(t + chargeModel.balanceOf(c)), 0);
  return ok(res, {
    student: svc.shapeStudent(found.student, found.batch, campuses.get(found.campusId) || null),
    charges, accruing, balance,
  });
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

async function createPayment(req, res) {
  const body = req.body || {};
  const sid = cleanObjectId(body.studentId, 'student');
  if (sid.error) return badRequest(res, sid.error);
  if (isBlank(body.amount)) return badRequest(res, 'Amount is required');
  const al = validateAllocations(body.allocations, body.amount);
  if (al.error) return badRequest(res, al.error);
  const note = cleanOptionalText(body.note, 'Note');
  if (note.error) return badRequest(res, note.error);
  const rid = cleanRequestId(body.requestId);
  if (rid.error) return badRequest(res, rid.error);
  const r = await resolveCampus(req, body.campusId);
  if (r.fail) return r.fail(res);

  const found = await svc.findStudentById(sid.value);
  if (!found) return notFound(res, 'Student not found');

  let payment;
  let duplicate;
  try {
    ({ payment, duplicate } = await paymentService.createPayment({
      campus: r.campus, studentId: sid.value, allocations: al.value.allocations, total: al.value.total,
      note: note.value, userId: req.user.id, requestId: rid.value,
    }));
  } catch (err) {
    return failure(res, err);
  }
  if (duplicate) {
    // Already recorded (retry / double click): same receipt, no new audit entry.
    try {
      const [view] = await paymentModel.shapeMany([payment]);
      return ok(res, { payment: view }, 'Payment already recorded');
    } catch (err) {
      console.error('[fines] duplicate-payment response build', err);
      return ok(res, { payment: { id: String(payment._id), receiptNumber: payment.receiptNumber, amount: payment.amount, receivedAt: payment.receivedAt } }, 'Payment already recorded');
    }
  }

  // ---- committed: from here on NEVER return an error ----
  const n = payment.allocations.length;
  await logAudit(req, 'CREATE', 'Payment', String(payment._id),
    `Received ${rupee(payment.amount)} from ${found.student.regNumber} (${found.student.fullName}) — receipt ${payment.receiptNumber} (${n} charge${n === 1 ? '' : 's'})`);
  try {
    const [view] = await paymentModel.shapeMany([payment]);
    return created(res, { payment: view });
  } catch (err) {
    console.error('[fines] post-payment response build', err);
    return created(res, {
      payment: { id: String(payment._id), receiptNumber: payment.receiptNumber, amount: payment.amount, receivedAt: payment.receivedAt },
    }, 'Payment recorded — open the receipt from Payments to print it');
  }
}

async function listPayments(req, res) {
  const q = req.query;
  const s = readScope(req, q.campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'payments');

  const today = todayIst();
  const from = isBlank(q.from) ? { value: today } : cleanYmd(q.from, 'From date');
  if (from.error) return badRequest(res, from.error);
  const to = isBlank(q.to) ? { value: from.value > today ? from.value : today } : cleanYmd(q.to, 'To date');
  if (to.error) return badRequest(res, to.error);
  if (from.value > to.value) return badRequest(res, 'From date cannot be after To date');
  const includeVoided = cleanBool(q.includeVoided, true);
  if (includeVoided === null) return badRequest(res, 'Invalid includeVoided');

  const filter = {
    ...s.scope,
    receivedAt: { $gte: dayRange(from.value).$gte, $lt: dayRange(to.value).$lt },
  };
  if (!isBlank(q.staffId)) {
    const st = cleanObjectId(q.staffId, 'staff member');
    if (st.error) return badRequest(res, st.error);
    filter.receivedBy = new ObjectId(st.value);
  }
  if (!isBlank(q.studentId)) {
    const st = cleanObjectId(q.studentId, 'student');
    if (st.error) return badRequest(res, st.error);
    filter.studentId = new ObjectId(st.value);
  }
  if (!includeVoided) filter.voided = null;

  const { page, limit } = pageOf(req);
  const [total, docs] = await Promise.all([
    Payment.countDocuments(filter),
    Payment.find(filter).sort({ receivedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return ok(res, { items: await paymentModel.shapeMany(docs), total, page, limit });
}

async function getPayment(req, res) {
  const id = cleanObjectId(req.params.id, 'payment');
  if (id.error) return notFound(res, 'Payment not found');
  const doc = await paymentModel.findById(id.value);
  if (!doc) return notFound(res, 'Payment not found');
  if (!assertCampusAccess(req, doc.campusId)) return deny(req, res, 'payment');
  const [view] = await paymentModel.shapeMany([doc]);
  return ok(res, view);
}

async function voidPayment(req, res) {
  if (!requireAdmin(req, res, 'void a payment')) return;
  const id = cleanObjectId(req.params.id, 'payment');
  if (id.error) return notFound(res, 'Payment not found');
  const reason = cleanRequiredText((req.body || {}).reason, 'Reason');
  if (reason.error) return badRequest(res, reason.error);
  const doc = await paymentModel.findById(id.value);
  if (!doc) return notFound(res, 'Payment not found');

  let voided;
  try {
    voided = await paymentService.voidPayment({ paymentId: doc._id, reason: reason.value, userId: req.user.id });
  } catch (err) {
    return failure(res, err);
  }

  // ---- committed: from here on NEVER return an error ----
  await logAudit(req, 'UPDATE', 'Payment', String(doc._id),
    `Voided receipt ${doc.receiptNumber} (${rupee(doc.amount)}) — reason: ${reason.value}`);
  try {
    const [view] = await paymentModel.shapeMany([voided]);
    return ok(res, view);
  } catch (err) {
    console.error('[fines] post-void response build', err);
    return ok(res, { id: String(doc._id), receiptNumber: doc.receiptNumber, voided: voided.voided }, 'Voided — refresh to see the receipt');
  }
}

async function paymentSummary(req, res) {
  const s = readScope(req, req.query.campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'payments');
  const date = isBlank(req.query.date) ? { value: todayIst() } : cleanYmd(req.query.date, 'Date');
  if (date.error) return badRequest(res, date.error);

  const dayFilter = { ...s.scope, receivedAt: dayRange(date.value) };
  const LIST_CAP = 1000;
  const me = String(req.user.id);
  // Totals and byStaff come from an aggregate (never truncated); only the listed payments are capped.
  const [byStaffMap, listedCount, docs] = await Promise.all([
    finePending.paymentTotalsByStaff(dayFilter),
    Payment.countDocuments(dayFilter),
    Payment.find(dayFilter).sort({ receivedAt: -1, _id: -1 }).limit(LIST_CAP).lean(),
  ]);
  const totalsOut = finePending.collectionTotals(byStaffMap, me);
  const [users, campuses, payments] = await Promise.all([
    User.find({ _id: { $in: [...byStaffMap.keys()] } }).select('name').lean(),
    s.scope.campusId ? campusModel.summariesByIds([s.scope.campusId]) : new Map(),
    paymentModel.shapeMany(docs),
  ]);
  const nameOf = new Map(users.map((u) => [String(u._id), u.name]));
  const byStaff = [...byStaffMap.entries()]
    .map(([id, e]) => ({ staff: { id, name: nameOf.get(id) || 'Unknown' }, total: e.total, count: e.count }))
    .sort((a, b) => b.total - a.total);

  return ok(res, {
    date: date.value,
    campus: s.scope.campusId ? campuses.get(String(s.scope.campusId)) || null : null,
    ...totalsOut,
    byStaff, payments, paymentsTruncated: listedCount > LIST_CAP,
  });
}

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

async function requestWaiver(req, res) {
  const body = req.body || {};
  const cid = cleanObjectId(body.chargeId, 'charge');
  if (cid.error) return badRequest(res, cid.error);
  const amount = cleanPositiveMoney(body.amount, 'Amount');
  if (amount.error) return badRequest(res, amount.error);
  const reason = cleanRequiredText(body.reason, 'Reason');
  if (reason.error) return badRequest(res, reason.error);

  const charge = await chargeModel.findById(cid.value);
  if (!charge) return notFound(res, 'Charge not found');
  if (!assertCampusAccess(req, charge.campusId)) return deny(req, res, 'charge');

  const isAdmin = req.library.isAdmin;
  let waiver;
  try {
    waiver = await waiverService.createWaiver({
      charge, amount: amount.value, reason: reason.value, userId: req.user.id, isAdmin,
    });
  } catch (err) {
    return failure(res, err);
  }

  // ---- committed: from here on NEVER return an error ----
  const label = await chargeLabel(charge);
  await logAudit(req, 'CREATE', 'Waiver', String(waiver._id), isAdmin
    ? `Waived ${rupee(amount.value)} (direct) on ${label} — reason: ${reason.value}`
      + (waiver.closedRequests?.length ? ` (closed ${waiver.closedRequests.length} pending request${waiver.closedRequests.length === 1 ? '' : 's'})` : '')
    : `Requested waiver ${rupee(amount.value)} on ${label} — reason: ${reason.value}`);
  for (const c of waiver.closedRequests || []) {
    await logAudit(req, 'UPDATE', 'Waiver', c.id,
      `Closed waiver request ${rupee(c.amount)} on ${label} — charge fully waived by direct waiver ${waiver._id}`);
  }
  try {
    const [view] = await waiverModel.shapeMany([waiver]);
    return created(res, view);
  } catch (err) {
    console.error('[fines] post-waiver response build', err);
    return created(res, { id: String(waiver._id), type: waiver.type, status: waiver.status, amount: waiver.amount },
      'Saved — refresh to see the details');
  }
}

async function listWaivers(req, res) {
  const q = req.query;
  if (!isBlank(q.status) && !WAIVER_STATUSES.includes(q.status)) return badRequest(res, 'Invalid status');
  const mine = cleanBool(q.mine, false);
  if (mine === null) return badRequest(res, 'Invalid mine');
  const s = readScope(req, q.campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'waivers');

  const filter = { ...s.scope };
  if (!isBlank(q.status)) filter.status = q.status;
  if (mine) filter.requestedBy = new ObjectId(String(req.user.id));
  const { page, limit } = pageOf(req);
  const [total, docs] = await Promise.all([
    Waiver.countDocuments(filter),
    Waiver.find(filter).sort({ requestedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return ok(res, { items: await waiverModel.shapeMany(docs), total, page, limit });
}

// Shared loading + checks for approve / reject. { waiver } | { fail(res) }.
async function loadPendingWaiver(req) {
  const id = cleanObjectId(req.params.id, 'waiver');
  if (id.error) return { fail: (res) => notFound(res, 'Waiver not found') };
  const waiver = await waiverModel.findById(id.value);
  if (!waiver) return { fail: (res) => notFound(res, 'Waiver not found') };
  if (waiver.status !== 'PENDING') return { fail: (res) => badRequest(res, 'This request has already been decided') };
  return { waiver };
}

async function approveWaiver(req, res) {
  if (!requireAdmin(req, res, 'approve a waiver')) return;
  const body = req.body || {};
  let amount;
  if (!isBlank(body.amount)) {
    const a = cleanPositiveMoney(body.amount, 'Amount');
    if (a.error) return badRequest(res, a.error);
    amount = a.value;
  }
  const note = cleanOptionalText(body.note, 'Note');
  if (note.error) return badRequest(res, note.error);
  const l = await loadPendingWaiver(req);
  if (l.fail) return l.fail(res);
  if (amount !== undefined && amount > l.waiver.amount + chargeModel.MONEY_TOLERANCE) {
    return badRequest(res, 'Approved amount cannot exceed the requested amount');
  }

  let out;
  try {
    out = await waiverService.approveWaiver({ waiverId: l.waiver._id, amount, note: note.value, userId: req.user.id });
  } catch (err) {
    return failure(res, err);
  }

  // ---- committed: from here on NEVER return an error ----
  const charge = await chargeModel.findById(l.waiver.chargeId).catch(() => null);
  const label = charge ? await chargeLabel(charge) : 'charge';
  if (out.closed) {
    // The approve did NOT happen: the request was closed instead. 409 (not 2xx) so no API
    // consumer mistakes this for an approval; the closed waiver is still returned in `data`.
    await logAudit(req, 'UPDATE', 'Waiver', String(l.waiver._id),
      `Closed waiver request ${rupee(out.requested)} on ${label} — approve attempted but nothing left to waive (charge already settled)`
      + (amount !== undefined ? `; requested approval amount ${rupee(amount)}` : '')
      + (note.value ? `; approver note discarded: ${note.value}` : ''));
    const msg = 'Nothing left to waive — the charge is already settled, so the request was closed instead of approved';
    let view;
    try {
      [view] = await waiverModel.shapeMany([out.waiver]);
    } catch (err) {
      console.error('[fines] post-close response build', err);
      view = { id: String(l.waiver._id), status: 'REJECTED', approvedAmount: null };
    }
    return res.status(409).json({ success: false, code: 'WAIVER_CLOSED_SETTLED', message: msg, data: view });
  }
  await logAudit(req, 'UPDATE', 'Waiver', String(l.waiver._id),
    `Approved waiver ${rupee(out.applied)} on ${label}`
    + (out.applied !== out.requested ? ` (requested ${rupee(out.requested)})` : '')
    + (note.value ? ` — note: ${note.value}` : ''));
  try {
    const [view] = await waiverModel.shapeMany([out.waiver]);
    return ok(res, view);
  } catch (err) {
    console.error('[fines] post-approve response build', err);
    return ok(res, { id: String(l.waiver._id), status: 'APPROVED', approvedAmount: out.applied }, 'Approved — refresh to see the details');
  }
}

async function rejectWaiver(req, res) {
  if (!requireAdmin(req, res, 'reject a waiver')) return;
  const note = cleanRequiredText((req.body || {}).note, 'Note');
  if (note.error) return badRequest(res, note.error);
  const l = await loadPendingWaiver(req);
  if (l.fail) return l.fail(res);

  let decided;
  try {
    decided = await waiverService.rejectWaiver({ waiverId: l.waiver._id, note: note.value, userId: req.user.id });
  } catch (err) {
    return failure(res, err);
  }

  // ---- committed: from here on NEVER return an error ----
  const charge = await chargeModel.findById(l.waiver.chargeId).catch(() => null);
  const label = charge ? await chargeLabel(charge) : 'charge';
  await logAudit(req, 'UPDATE', 'Waiver', String(l.waiver._id),
    `Rejected waiver ${rupee(l.waiver.amount)} on ${label} — note: ${note.value}`);
  try {
    const [view] = await waiverModel.shapeMany([decided]);
    return ok(res, view);
  } catch (err) {
    console.error('[fines] post-reject response build', err);
    return ok(res, { id: String(l.waiver._id), status: 'REJECTED' }, 'Rejected — refresh to see the details');
  }
}

// ---------------------------------------------------------------------------
// No-fine periods
// ---------------------------------------------------------------------------

async function listFinePeriods(req, res) {
  const s = readScope(req, req.query.campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'fine periods');
  return ok(res, await finePeriodModel.shapeMany(await finePeriodModel.list(s.scope)));
}

// Admin: validated { campus, range } for preview / create. { fail(res) } on any problem.
async function periodInputs(req, src) {
  const r = await resolveCampus(req, src.campusId);
  if (r.fail) return r;
  const range = cleanDateRange(src.from, src.to);
  if (range.error) return { fail: (res) => badRequest(res, range.error) };
  return { campus: r.campus, range: range.value };
}

async function previewFinePeriod(req, res) {
  if (!requireAdmin(req, res, 'preview a fine period')) return;
  const p = await periodInputs(req, req.query);
  if (p.fail) return p.fail(res);
  return ok(res, await finePeriodService.preview({ campusId: p.campus.id, ...p.range }));
}

async function createFinePeriod(req, res) {
  if (!requireAdmin(req, res, 'create a fine period')) return;
  const body = req.body || {};
  const p = await periodInputs(req, body);
  if (p.fail) return p.fail(res);
  const reason = cleanRequiredText(body.reason, 'Reason');
  if (reason.error) return badRequest(res, reason.error);

  let out;
  try {
    out = await finePeriodService.createPeriod({ campusId: p.campus.id, ...p.range, reason: reason.value, userId: req.user.id });
  } catch (err) {
    return failure(res, err);
  }

  // ---- committed: from here on NEVER return an error ----
  const { period, applied } = out;
  const entries = [{
    action: 'CREATE', entity: 'FinePeriod', entityId: period._id,
    description: `Created no-fine period ${p.campus.code} ${period.from} → ${period.to} (${period.reason}) — ${applied.length} charge${applied.length === 1 ? '' : 's'} waived, ${rupee(out.totalWaived)}`,
  }];
  try {
    const [students, copies] = await Promise.all([
      Student.find({ _id: { $in: applied.map((r) => r.charge.studentId) } }).select('fullName regNumber').lean(),
      BookCopy.find({ _id: { $in: applied.map((r) => r.charge.copyId) } }).select('catalogNumber').lean(),
    ]);
    const st = new Map(students.map((x) => [String(x._id), x]));
    const cp = new Map(copies.map((x) => [String(x._id), x]));
    for (const r of applied) {
      const s1 = st.get(String(r.charge.studentId));
      entries.push({
        action: 'CREATE', entity: 'Waiver', entityId: r.charge._id,
        description: `Bulk waiver ${rupee(r.waivable)} on LATE charge ${cp.get(String(r.charge.copyId))?.catalogNumber || ''} for ${s1?.regNumber || ''} (${s1?.fullName || ''}) — no-fine period ${period.from} → ${period.to}`,
      });
    }
  } catch (err) { console.error('[fines] post-period audit lookups', err.message); }
  await logAuditMany(req, entries);

  try {
    const [view] = await finePeriodModel.shapeMany([period]);
    return created(res, {
      period: view, appliedWaivers: applied.length, totalWaived: out.totalWaived, paidNotRefunded: out.paidNotRefunded,
    });
  } catch (err) {
    console.error('[fines] post-period response build', err);
    return created(res, {
      period: { id: String(period._id), from: period.from, to: period.to },
      appliedWaivers: applied.length, totalWaived: out.totalWaived, paidNotRefunded: out.paidNotRefunded,
    }, 'Period created — refresh to see the list');
  }
}

async function cancelFinePeriod(req, res) {
  if (!requireAdmin(req, res, 'cancel a fine period')) return;
  const id = cleanObjectId(req.params.id, 'period');
  if (id.error) return notFound(res, 'Period not found');
  const reason = cleanRequiredText((req.body || {}).reason, 'Reason');
  if (reason.error) return badRequest(res, reason.error);
  const existing = await finePeriodModel.findById(id.value);
  if (!existing) return notFound(res, 'Period not found');

  let doc;
  try {
    doc = await finePeriodService.cancelPeriod({ periodId: existing._id, reason: reason.value, userId: req.user.id });
  } catch (err) {
    return failure(res, err);
  }

  // ---- committed: from here on NEVER return an error ----
  let code = '';
  try { code = (await campusModel.summariesByIds([doc.campusId])).get(String(doc.campusId))?.code || ''; } catch (err) { console.error('[fines] campus lookup', err.message); }
  await logAudit(req, 'UPDATE', 'FinePeriod', String(doc._id),
    `Cancelled no-fine period ${code} ${doc.from} → ${doc.to} — reason: ${reason.value}`);
  try {
    const [view] = await finePeriodModel.shapeMany([doc]);
    return ok(res, view);
  } catch (err) {
    console.error('[fines] post-cancel response build', err);
    return ok(res, { id: String(doc._id), cancelled: doc.cancelled }, 'Cancelled — refresh to see the list');
  }
}

module.exports = {
  pending, studentFines, createPayment, listPayments, getPayment, voidPayment, paymentSummary,
  requestWaiver, listWaivers, approveWaiver, rejectWaiver,
  listFinePeriods, previewFinePeriod, createFinePeriod, cancelFinePeriod,
};
