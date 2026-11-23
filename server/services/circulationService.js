// Circulation business logic: eligibility, ledger maths and the three transactions
// (issue / return / renew). No req/res here - controllers translate errors to HTTP.
const { mongoose } = require('../utils/db');
const { Student, Batch, Book, BookCopy, Loan } = require('../models/schemas');
const loanModel = require('../models/loanModel');
const chargeModel = require('../models/chargeModel');
const studentState = require('../models/studentStateModel');
const campusModel = require('../models/campusModel');
const fine = require('./fineService');
const finePeriodModel = require('../models/finePeriodModel');

const ObjectId = mongoose.Types.ObjectId;
const MAJOR_DAMAGE_REASON = 'Major damage on return';

// 400-style business failure. `reasons` is [{ code, message }].
class CirculationError extends Error {
  constructor(message, reasons) {
    super(message);
    this.name = 'CirculationError';
    this.status = 400;
    this.reasons = reasons || [{ code: 'FAILED', message }];
  }
}

// Rupee text: whole numbers without decimals ("50"), otherwise 2 decimals ("12.50").
const money = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(2));

// ---------------------------------------------------------------------------
// Ledger (open loans + unpaid charges across ALL campuses)
// ---------------------------------------------------------------------------

async function loadLedger(studentId, { session } = {}) {
  const [openLoans, charges] = await Promise.all([
    loanModel.findOpenByStudent(studentId, { session }),
    chargeModel.findUnpaidByStudent(studentId, { session }),
  ]);
  // Active no-fine periods of the open loans' campuses (one batched query) - every live fine
  // below is computed with them.
  const periods = await finePeriodModel.loadActive(openLoans.map((l) => l.campusId), { session });
  return { openLoans, charges, periods };
}

// Map<campusId, { openLoans, overdueLoans, outstanding }> + grand total.
// outstanding = unpaid charge balances + live late fines of open loans.
function summarizeLedger(ledger, now = new Date()) {
  const byCampus = new Map();
  const slot = (campusId) => {
    const k = String(campusId);
    if (!byCampus.has(k)) byCampus.set(k, { openLoans: 0, overdueLoans: 0, outstanding: 0 });
    return byCampus.get(k);
  };
  for (const l of ledger.openLoans) {
    const s = slot(l.campusId);
    s.openLoans += 1;
    if (fine.isOverdue(l, now)) s.overdueLoans += 1;
    s.outstanding = fine.round2(s.outstanding + fine.lateFine(l, now, { periods: ledger.periods?.get(String(l.campusId)) || [] }));
  }
  for (const c of ledger.charges) {
    const s = slot(c.campusId);
    s.outstanding = fine.round2(s.outstanding + chargeModel.balanceOf(c));
  }
  let total = 0;
  for (const s of byCampus.values()) total = fine.round2(total + s.outstanding);
  return { byCampus, total };
}

// ---------------------------------------------------------------------------
// Student lookup + eligibility
// ---------------------------------------------------------------------------

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// regNumber is stored as typed, so: exact match first; otherwise a case-insensitive anchored
// match that is accepted only when exactly ONE student matches (ambiguous = not found).
// The ONE resolver for reg numbers in circulation.
async function findStudentByReg(regNumber) {
  const fields = 'fullName regNumber batchId isActive photo';
  let student = await Student.findOne({ regNumber }).select(fields).lean();
  if (!student) {
    const matches = await Student.find({ regNumber: { $regex: `^${escapeRegex(regNumber)}$`, $options: 'i' } })
      .select(fields).limit(2).lean();
    student = matches.length === 1 ? matches[0] : null;
  }
  if (!student) return null;
  const batch = await Batch.findById(student.batchId).select('name campusId').lean();
  return { student, batch, campusId: batch?.campusId ? String(batch.campusId) : null };
}

async function findStudentById(studentId) {
  const student = await Student.findById(studentId).select('fullName regNumber batchId isActive photo').lean();
  if (!student) return null;
  const batch = await Batch.findById(student.batchId).select('name campusId').lean();
  return { student, batch, campusId: batch?.campusId ? String(batch.campusId) : null };
}

// Non-admin visibility: own-campus batch, OR an open loan / unpaid charge at the own campus.
// `includeHistory` (history endpoint) also accepts any past loan/charge at the own campus.
async function canStaffSeeStudent({ campusId: studentCampusId, ledger, studentId, ownCampusId, includeHistory = false }) {
  if (studentCampusId && studentCampusId === String(ownCampusId)) return true;
  if (ledger.openLoans.some((l) => String(l.campusId) === String(ownCampusId))) return true;
  if (ledger.charges.some((c) => String(c.campusId) === String(ownCampusId))) return true;
  if (!includeHistory) return false;
  const [loan, charge] = await Promise.all([
    loanModel.hasAnyAtCampus(studentId, ownCampusId),
    chargeModel.hasAnyAtCampus(studentId, ownCampusId),
  ]);
  return loan || charge;
}

// Student-level eligibility, in contract order; ALL reasons are collected.
function evaluateEligibility({ student, studentCampusId, deskCampus, ledger, summary, settings }) {
  const reasons = [];
  if (!student) return [{ code: 'STUDENT_NOT_FOUND', message: 'No student with this Reg Number' }];
  if (!studentCampusId || String(studentCampusId) !== String(deskCampus.id)) {
    reasons.push({
      code: 'NOT_THIS_CAMPUS',
      message: studentCampusId
        ? `This student's batch is not in ${deskCampus.name}`
        : "This student's batch is not assigned to a campus",
    });
  }
  if (!student.isActive) reasons.push({ code: 'INACTIVE', message: 'Student is inactive' });
  const held = ledger.openLoans.length;
  if (held >= settings.maxBooks) {
    reasons.push({ code: 'LIMIT', message: `Already holds ${held} book${held === 1 ? '' : 's'}` });
  }
  if (ledger.openLoans.some((l) => fine.isOverdue(l))) {
    reasons.push({ code: 'OVERDUE', message: 'Has an overdue book' });
  }
  if (summary.total > settings.fineBlockThreshold) {
    reasons.push({
      code: 'DUES',
      message: `Unpaid charges ₹${money(summary.total)} exceed the ₹${money(settings.fineBlockThreshold)} limit`,
    });
  }
  return reasons;
}

// Copy-level reason (or null).
function copyReason(copy, deskCampus, openLoan) {
  if (!copy) return { code: 'COPY_NOT_FOUND', message: `No copy with this catalog number in ${deskCampus.name}` };
  if (copy.status !== 'AVAILABLE') {
    const due = copy.status === 'ISSUED' && openLoan ? ` (due ${openLoan.dueDate})` : '';
    return { code: 'COPY_NOT_AVAILABLE', message: `Copy is ${copy.status.toLowerCase()}${due}` };
  }
  return null;
}

// StudentCard for a desk campus. `ledger` must already be loaded for this student.
async function buildStudentCard({ student, batch, campusId: studentCampusId, deskCampus, ledger, settings, now = new Date() }) {
  const summary = summarizeLedger(ledger, now);
  const deskId = String(deskCampus.id);
  const deskLoans = ledger.openLoans.filter((l) => String(l.campusId) === deskId);
  const deskCharges = ledger.charges.filter((c) => String(c.campusId) === deskId);

  const [loans, charges, campuses] = await Promise.all([
    loanModel.shapeMany(deskLoans, { settings, now, periods: ledger.periods }),
    chargeModel.shapeMany(deskCharges),
    campusModel.summariesByIds(studentCampusId ? [studentCampusId] : []),
  ]);

  const mine = summary.byCampus.get(deskId) || { outstanding: 0 };
  const otherCampuses = otherCampusSummary(summary, deskId, await codesFor(summary, deskId));
  const reasons = evaluateEligibility({ student, studentCampusId, deskCampus, ledger, summary, settings });

  return {
    student: shapeStudent(student, batch, campuses.get(studentCampusId) || null),
    loans,
    charges,
    otherCampuses,
    outstanding: { thisCampus: mine.outstanding, total: summary.total },
    eligibility: { canIssue: reasons.length === 0, reasons },
    settings: { maxBooks: settings.maxBooks, fineBlockThreshold: settings.fineBlockThreshold, loanDays: settings.loanDays },
  };
}

function shapeStudent(student, batch, campus) {
  return {
    id: String(student._id),
    fullName: student.fullName,
    regNumber: student.regNumber,
    photo: student.photo || null,
    isActive: !!student.isActive,
    batch: batch ? { id: String(batch._id), name: batch.name } : null,
    campus: campus || null,
  };
}

// Campus codes of every campus in the summary other than `exceptId` (one batched query).
async function codesFor(summary, exceptId) {
  const ids = [...summary.byCampus.keys()].filter((k) => k !== String(exceptId));
  if (ids.length === 0) return [];
  const map = await campusModel.summariesByIds(ids);
  return ids.map((id) => map.get(id)?.code).filter(Boolean).sort();
}

// OtherCampusSummary | null (null when the student has nothing at any other campus).
function otherCampusSummary(summary, exceptId, codes) {
  let openLoans = 0;
  let overdueLoans = 0;
  let outstanding = 0;
  for (const [k, s] of summary.byCampus) {
    if (k === String(exceptId)) continue;
    openLoans += s.openLoans;
    overdueLoans += s.overdueLoans;
    outstanding = fine.round2(outstanding + s.outstanding);
  }
  if (openLoans === 0 && outstanding === 0) return null;
  return { openLoans, overdueLoans, outstanding, campuses: codes };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

const withSession = async (fn) => {
  const session = await mongoose.startSession();
  try {
    return await fn(session);
  } finally {
    await session.endSession();
  }
};

// Issue. Preconditions (checked by the controller before calling): student exists, belongs to
// the desk campus, copy belongs to the desk campus. Everything race-sensitive is re-verified
// INSIDE the transaction. The callback is retry-safe (no side effects outside the session).
// Returns the created raw loan doc. Throws CirculationError (400) on any business failure.
async function issueLoan({ student, copy, settings, userId, issuedAt, backdateReason }) {
  await studentState.ensure(student._id);
  let loan = null;
  try {
    await withSession((session) => session.withTransaction(async () => {
      loan = null;
      const now = new Date();

      // (a) claim the copy atomically
      const claimed = await BookCopy.findOneAndUpdate(
        { _id: copy._id, campusId: copy.campusId, status: 'AVAILABLE' },
        { $set: { status: 'ISSUED' } },
        { new: true, session },
      ).lean();
      if (!claimed) {
        throw new CirculationError('Copy is no longer available', [{ code: 'COPY_NOT_AVAILABLE', message: 'Copy is no longer available' }]);
      }

      const fresh = await Student.findById(student._id).select('isActive').session(session).lean();
      if (!fresh || !fresh.isActive) {
        throw new CirculationError('Student is inactive', [{ code: 'INACTIVE', message: 'Student is inactive' }]);
      }

      // (b) atomic book-limit gate
      const gate = await studentState.tryIncrement(student._id, settings.maxBooks, { session });
      if (!gate) {
        throw new CirculationError(`Already holds ${settings.maxBooks} books`, [
          { code: 'LIMIT', message: `Already holds ${settings.maxBooks} book${settings.maxBooks === 1 ? '' : 's'}` },
        ]);
      }

      // (c) re-check overdue + dues on session reads
      const ledger = await loadLedger(student._id, { session });
      const summary = summarizeLedger(ledger, now);
      const reasons = [];
      if (ledger.openLoans.some((l) => fine.isOverdue(l, now))) {
        reasons.push({ code: 'OVERDUE', message: 'Has an overdue book' });
      }
      if (summary.total > settings.fineBlockThreshold) {
        reasons.push({
          code: 'DUES',
          message: `Unpaid charges ₹${money(summary.total)} exceed the ₹${money(settings.fineBlockThreshold)} limit`,
        });
      }
      if (reasons.length) throw new CirculationError(reasons[0].message, reasons);

      // (d) the loan itself
      const when = issuedAt || now;
      const doc = {
        campusId: copy.campusId, copyId: copy._id, bookId: copy.bookId, studentId: student._id,
        issuedAt: when, issuedBy: new ObjectId(String(userId)),
        dueDate: fine.dueDateFor(when, settings.loanDays),
        loanDays: settings.loanDays, finePerDay: settings.finePerDay,
        renewCount: 0, renewals: [], status: 'OPEN',
      };
      if (backdateReason) doc.backdated = { issue: { reason: backdateReason, by: new ObjectId(String(userId)), at: now } };
      const [created] = await Loan.create([doc], { session });
      loan = created.toObject();
    }));
  } catch (err) {
    // The partial unique index (one OPEN loan per copy) is the last line of defence.
    if (err?.code === 11000) {
      throw new CirculationError('Copy is no longer available', [{ code: 'COPY_NOT_AVAILABLE', message: 'Copy is no longer available' }]);
    }
    throw err;
  }
  return loan;
}

// Return. Loan, fine and charges are all computed from session reads. Returns
// { loan, charges, copyStatus, copy, book } (raw docs). Throws CirculationError.
async function returnLoan({ loanId, userId, condition, severity, charge, returnedAt, backdateReason }) {
  let out = null;
  const pre = await loanModel.findById(loanId);
  if (pre) await finePeriodModel.ensureCounter(pre.campusId);
  await withSession((session) => session.withTransaction(async () => {
    out = null;
    const now = new Date();
    const by = new ObjectId(String(userId));

    const loan = await loanModel.findById(loanId, { session });
    if (!loan || loan.status !== 'OPEN') throw new CirculationError('This loan is already closed');
    // Same-doc write as createPeriod / cancelPeriod: a period change racing this return conflicts.
    await finePeriodModel.touchEpoch(loan.campusId, 'lastReturnAt', { session });
    const endAt = returnedAt || now;
    if (endAt < loan.issuedAt) throw new CirculationError('Return time cannot be before the issue time');

    const book = await Book.findById(loan.bookId).select('title price').session(session).lean();
    const campusPeriods = await finePeriodModel.activeForCampus(loan.campusId, { session });
    const bd = fine.fineBreakdown({ ...loan, returnedAt: endAt }, endAt, campusPeriods);
    const days = bd.daysLate;            // raw days late (stored as fineDays)
    const waivedDays = bd.waivedDays;    // days inside no-fine periods (stored as fineWaivedDays)
    const lateAmount = bd.lateFine;      // chargeable days x rate

    let damageAmount = 0;
    let loanCondition = 'GOOD';
    if (condition === 'DAMAGED') {
      loanCondition = severity === 'MAJOR' ? 'DAMAGED_MAJOR' : 'DAMAGED_MINOR';
      if (charge !== undefined && charge !== null) damageAmount = charge;
      else if (severity === 'MAJOR' && book?.price !== null && book?.price !== undefined) damageAmount = fine.round2(book.price);
      else throw new CirculationError('Enter the damage charge (this book has no price on record)');
    }

    const set = {
      status: 'RETURNED', returnedAt: endAt, returnedBy: by, condition: loanCondition,
      fineDays: days, fineWaivedDays: waivedDays, waivedRanges: bd.waivedRanges, fineAmount: lateAmount,
    };
    if (backdateReason) set['backdated.return'] = { reason: backdateReason, by, at: now };
    const closed = await Loan.findOneAndUpdate({ _id: loan._id, status: 'OPEN' }, { $set: set }, { new: true, session }).lean();
    if (!closed) throw new CirculationError('This loan is already closed');

    let copySet = { status: 'AVAILABLE' };
    if (loanCondition === 'DAMAGED_MINOR') copySet = { status: 'DAMAGED' };
    if (loanCondition === 'DAMAGED_MAJOR') {
      copySet = {
        status: 'WITHDRAWN', withdrawReason: MAJOR_DAMAGE_REASON, withdrawnBy: by,
        withdrawnAt: now, statusBeforeWithdraw: null,
      };
    }
    // Only an ISSUED copy transitions. If its status drifted the loan still closes (and charges
    // are still raised); the drifted status is reported back instead of being overwritten.
    const copy = await BookCopy.findOneAndUpdate(
      { _id: loan.copyId, status: 'ISSUED' }, { $set: copySet }, { new: true, session },
    ).lean();
    let copyDriftStatus = null;
    if (!copy) {
      const cur = await BookCopy.findById(loan.copyId).select('status').session(session).lean();
      copyDriftStatus = cur ? cur.status : 'MISSING';
    }

    await studentState.decrement(loan.studentId, { session });

    const docs = [];
    const base = {
      campusId: loan.campusId, studentId: loan.studentId, loanId: loan._id, copyId: loan.copyId,
      paidAmount: 0, waivedAmount: 0, status: 'UNPAID', createdBy: by,
    };
    if (lateAmount > 0) {
      docs.push({ ...base, type: 'LATE', amount: lateAmount, note: `Late return: ${bd.chargeableDays} day${bd.chargeableDays === 1 ? '' : 's'} × ₹${money(loan.finePerDay)}`
          + (waivedDays > 0 ? ` (${waivedDays} no-fine day${waivedDays === 1 ? '' : 's'} excluded)` : ''),
      });
    }
    if (damageAmount > 0) {
      docs.push({ ...base, type: 'DAMAGE', amount: damageAmount, note: `Damaged on return (${severity === 'MAJOR' ? 'major' : 'minor'})` });
    }
    const charges = await chargeModel.insertMany(docs, { session });
    out = { loan: closed, charges, copy, book, daysLate: days, waivedDays, chargeableDays: bd.chargeableDays, lateAmount, damageAmount, copyDriftStatus };
  }));
  return out;
}

// Report lost. Shaped like returnLoan: ONE transaction closes the loan as LOST (fine frozen at
// lostAt), marks the copy LOST, frees the student's slot and raises the LATE / LOST charges.
// `amount` is the lost-book charge (defaults to the book price); `note` is required when it
// differs from a known price. Returns { loan, charges, copy, book, daysLate, waivedDays,
// lateAmount, lostAmount, copyDriftStatus }. Throws CirculationError (400).
async function reportLost({ loanId, userId, amount, note, lostAt, backdateReason }) {
  let out = null;
  const pre = await loanModel.findById(loanId);
  if (pre) await finePeriodModel.ensureCounter(pre.campusId);
  await withSession((session) => session.withTransaction(async () => {
    out = null;
    const now = new Date();
    const by = new ObjectId(String(userId));

    const loan = await loanModel.findById(loanId, { session });
    if (!loan || loan.status !== 'OPEN') throw new CirculationError('This loan is already closed');
    // Same-doc write as returnLoan / createPeriod / cancelPeriod (write-skew guard).
    await finePeriodModel.touchEpoch(loan.campusId, 'lastReturnAt', { session });
    const endAt = lostAt || now;
    if (endAt < loan.issuedAt) throw new CirculationError('Lost time cannot be before the issue time');

    const book = await Book.findById(loan.bookId).select('title price').session(session).lean();
    const hasPrice = book?.price !== null && book?.price !== undefined;
    const lostAmount = amount !== undefined && amount !== null ? fine.round2(amount) : (hasPrice ? fine.round2(book.price) : null);
    if (lostAmount === null) throw new CirculationError('Enter the lost-book charge (this book has no price on record)');
    if (amount !== undefined && amount !== null && hasPrice && lostAmount !== fine.round2(book.price) && !note) {
      throw new CirculationError('A note is required when the charge differs from the book price');
    }

    const campusPeriods = await finePeriodModel.activeForCampus(loan.campusId, { session });
    const bd = fine.fineBreakdown({ ...loan, lostAt: endAt }, endAt, campusPeriods);

    const set = {
      status: 'LOST', lostAt: endAt, lostBy: by, condition: null,
      fineDays: bd.daysLate, fineWaivedDays: bd.waivedDays, waivedRanges: bd.waivedRanges, fineAmount: bd.lateFine,
    };
    if (backdateReason) set['backdated.lost'] = { reason: backdateReason, by, at: now };
    const closed = await Loan.findOneAndUpdate({ _id: loan._id, status: 'OPEN' }, { $set: set }, { new: true, session }).lean();
    if (!closed) throw new CirculationError('This loan is already closed');

    const copy = await BookCopy.findOneAndUpdate(
      { _id: loan.copyId, status: 'ISSUED' },
      { $set: { status: 'LOST', lostAt: endAt, lostBy: by, lostReason: note || 'Reported lost by student', lostSource: 'LOAN', stockCheckId: null } },
      { new: true, session },
    ).lean();
    let copyDriftStatus = null;
    if (!copy) {
      const cur = await BookCopy.findById(loan.copyId).select('status').session(session).lean();
      copyDriftStatus = cur ? cur.status : 'MISSING';
    }

    await studentState.decrement(loan.studentId, { session });

    const docs = [];
    const base = {
      campusId: loan.campusId, studentId: loan.studentId, loanId: loan._id, copyId: loan.copyId,
      paidAmount: 0, waivedAmount: 0, status: 'UNPAID', createdBy: by,
    };
    if (bd.lateFine > 0) {
      docs.push({ ...base, type: 'LATE', amount: bd.lateFine,
        note: `Late until reported lost: ${bd.chargeableDays} day${bd.chargeableDays === 1 ? '' : 's'} × ₹${money(loan.finePerDay)}`
          + (bd.waivedDays > 0 ? ` (${bd.waivedDays} no-fine day${bd.waivedDays === 1 ? '' : 's'} excluded)` : ''),
      });
    }
    if (lostAmount > 0) {
      docs.push({ ...base, type: 'LOST', amount: lostAmount, note: note ? `Lost book: ${note}` : 'Lost book' });
    }
    const charges = await chargeModel.insertMany(docs, { session });
    out = {
      loan: closed, charges, copy, book, daysLate: bd.daysLate, waivedDays: bd.waivedDays,
      lateAmount: bd.lateFine, lostAmount, copyDriftStatus,
    };
  }));
  return out;
}

// Mark found (LOST -> AVAILABLE) / repaired (DAMAGED -> AVAILABLE). Conditional updates; the
// charges of a found book are deliberately NOT touched. Returns { before, copy, loan } (raw docs)
// or throws CirculationError with the copy's current status.
async function markCopyFound({ copyId, userId }) {
  let out = null;
  await withSession((session) => session.withTransaction(async () => {
    out = null;
    const now = new Date();
    const by = new ObjectId(String(userId));
    const before = await BookCopy.findById(copyId).session(session).lean();
    const copy = await BookCopy.findOneAndUpdate(
      { _id: copyId, status: 'LOST' },
      { $set: { status: 'AVAILABLE', foundAt: now, foundBy: by } },
      { new: true, session },
    ).lean();
    if (!copy) {
      const cur = before ? before.status.toLowerCase() : 'missing';
      throw new CirculationError(`Copy is ${cur}, not Lost`);
    }
    let loan = null;
    if (before.lostSource === 'LOAN') {
      loan = await Loan.findOneAndUpdate(
        { copyId, status: 'LOST', foundAt: null },
        { $set: { foundAt: now, foundBy: by } },
        { new: true, sort: { lostAt: -1 }, session },
      ).lean();
    }
    out = { before, copy, loan };
  }));
  return out;
}

async function markCopyRepaired({ copyId, userId }) {
  const now = new Date();
  const copy = await BookCopy.findOneAndUpdate(
    { _id: copyId, status: 'DAMAGED' },
    { $set: { status: 'AVAILABLE', repairedAt: now, repairedBy: new ObjectId(String(userId)) } },
    { new: true },
  ).lean();
  if (!copy) {
    const cur = await BookCopy.findById(copyId).select('status').lean();
    throw new CirculationError(`Copy is ${cur ? cur.status.toLowerCase() : 'missing'}, not Damaged`);
  }
  return copy;
}

// Renew: one conditional findOneAndUpdate (atomic on the loan document).
async function renewLoan({ loanId, userId, settings }) {
  const now = new Date();
  const loan = await loanModel.findById(loanId);
  if (!loan) return null;
  const check = fine.renewalCheck(loan, settings, now);
  if (!check.allowed) throw new CirculationError(check.reason);

  const today = fine.istDate(now);
  const newDue = fine.renewedDueDate(loan, now);
  const updated = await Loan.findOneAndUpdate(
    {
      _id: loan._id, status: 'OPEN',
      renewCount: { $lt: settings.maxRenewals },
      dueDate: { $gte: today, $eq: loan.dueDate },
    },
    {
      $set: { dueDate: newDue },
      $inc: { renewCount: 1 },
      $push: { renewals: { at: now, by: new ObjectId(String(userId)), previousDueDate: loan.dueDate, newDueDate: newDue } },
    },
    { new: true },
  ).lean();
  if (!updated) {
    // Lost a race (renewed / returned / went overdue meanwhile) - explain with fresh data.
    const again = await loanModel.findById(loan._id);
    const recheck = again ? fine.renewalCheck(again, settings, new Date()) : { allowed: false, reason: 'Loan not found' };
    throw new CirculationError(recheck.allowed ? 'The loan changed - please try again' : recheck.reason);
  }
  return { loan: updated, previousDueDate: loan.dueDate, newDueDate: newDue };
}

module.exports = {
  CirculationError, withSession, money, loadLedger, summarizeLedger, findStudentByReg, findStudentById,
  canStaffSeeStudent, evaluateEligibility, copyReason, buildStudentCard, shapeStudent,
  codesFor, otherCampusSummary, issueLoan, returnLoan, renewLoan,
  reportLost, markCopyFound, markCopyRepaired,
};
