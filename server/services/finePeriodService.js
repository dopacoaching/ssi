// "No-fine" periods: preview, create (+ bulk waivers for already-returned loans) and cancel.
// No req/res here.
const { mongoose } = require('../utils/db');
const { FinePeriod, Loan, Charge, Waiver } = require('../models/schemas');
const chargeModel = require('../models/chargeModel');
const finePeriodModel = require('../models/finePeriodModel');
const fine = require('./fineService');
const { CirculationError, withSession } = require('./circulationService');

const ObjectId = mongoose.Types.ObjectId;
const oid = (v) => new ObjectId(String(v));

// IST midnight at the start of a YYYY-MM-DD day.
const dayStart = (ymd) => new Date(`${ymd}T00:00:00+05:30`);

// What a NEW period would waive on already-closed (RETURNED or LOST; end = returnedAt ?? lostAt) loans of the campus (no writes).
// Exact day tracking: each returned loan stores `waivedRanges` (days already excused, from the
// periods active at return plus earlier bulk waivers). New days = (late window (dueDate,
// returned-IST-date] ∩ new period) minus those ranges, so cancel / re-create never double-waives.
// rows: [{ loan, charge, newRanges, days, waivable, notRefunded }].
async function computeBulk({ campusId, from, to, session }) {
  const loans = await Loan.find({
    campusId, status: { $in: ['RETURNED', 'LOST'] }, dueDate: { $lt: to },
    $or: [{ returnedAt: { $gte: dayStart(from) } }, { lostAt: { $gte: dayStart(from) } }],
  }).select('dueDate returnedAt lostAt finePerDay waivedRanges').session(session || null).lean();
  const charges = loans.length
    ? await Charge.find({ campusId, type: 'LATE', loanId: { $in: loans.map((l) => l._id) } }).session(session || null).lean()
    : [];
  const chargeByLoan = new Map(charges.map((c) => [String(c.loanId), c]));

  const rows = [];
  let paidNotRefunded = 0;
  let totalWaivable = 0;
  for (const loan of loans) {
    const charge = chargeByLoan.get(String(loan._id));
    if (!charge) continue;
    const end = fine.istDate(loan.returnedAt || loan.lostAt);
    const newRanges = fine.subtractRanges(fine.overlapRanges(loan.dueDate, end, [{ from, to }]), loan.waivedRanges || []);
    const days = fine.countRangeDays(newRanges);
    if (days <= 0) continue;
    const wanted = Math.min(fine.round2(days * (loan.finePerDay || 0)), fine.round2(charge.amount - (charge.waivedAmount || 0)));
    const waivable = fine.round2(Math.max(0, Math.min(wanted, chargeModel.balanceOf(charge))));
    const notRefunded = fine.round2(Math.max(0, Math.min(wanted - waivable, charge.paidAmount || 0)));
    paidNotRefunded = fine.round2(paidNotRefunded + notRefunded);
    totalWaivable = fine.round2(totalWaivable + waivable);
    rows.push({ loan, charge, newRanges, days, waivable, notRefunded });
  }
  return { rows, returnedLoansAffected: rows.length, totalWaivable, paidNotRefunded };
}

async function preview({ campusId, from, to }) {
  const cid = oid(campusId);
  const bulk = await computeBulk({ campusId: cid, from, to });
  const openLoansAffected = await Loan.countDocuments({ campusId: cid, status: 'OPEN', dueDate: { $lt: to } });
  return {
    returnedLoansAffected: bulk.returnedLoansAffected, totalWaivable: bulk.totalWaivable,
    paidNotRefunded: bulk.paidNotRefunded, openLoansAffected,
  };
}

// Inserts the period and applies BULK waivers in ONE transaction (all or nothing).
// Returns { period, applied: rows[], totalWaived, paidNotRefunded } (raw docs).
async function createPeriod({ campusId, from, to, reason, userId }) {
  const cid = oid(campusId);
  const by = oid(userId);
  await finePeriodModel.ensureCounter(cid);
  let out = null;
  await withSession((session) => session.withTransaction(async () => {
    out = null;
    const now = new Date();
    // Same-doc write as returnLoan / cancelPeriod: a concurrent return conflicts and retries.
    await finePeriodModel.touchEpoch(cid, 'lastPeriodChangeAt', { session });
    const [period] = await FinePeriod.create([{ campusId: cid, from, to, reason, createdBy: by, cancelled: null }], { session });
    const bulk = await computeBulk({ campusId: cid, from, to, session });
    const applied = bulk.rows.filter((r) => r.waivable > 0);
    if (applied.length) {
      // Native driver bulkWrite: pipeline updates + $expr guards are passed through untouched.
      const res = await Charge.collection.bulkWrite(
        applied.map((r) => chargeModel.waiveOp({ _id: r.charge._id }, r.waivable)),
        { session, ordered: false },
      );
      if (res.matchedCount !== applied.length) throw new CirculationError('Some charges changed while applying — please try again');
      await Waiver.create(applied.map((r) => ({
        campusId: cid, studentId: r.charge.studentId, chargeId: r.charge._id, type: 'BULK',
        amount: r.waivable, approvedAmount: r.waivable, reason: `No-fine period ${from} → ${to}: ${reason}`,
        status: 'APPROVED', requestedBy: by, requestedAt: now, decidedBy: by, decidedAt: now,
        decisionNote: '', finePeriodId: period._id,
      })), { session, ordered: true });
    }
    // Record the newly excused days on EVERY affected loan (also when capped by a paid balance:
    // those days are "considered", matching the no-refund decision).
    if (bulk.rows.length) {
      await Loan.collection.bulkWrite(bulk.rows.map((r) => {
        const merged = fine.mergeRanges([...(r.loan.waivedRanges || []), ...r.newRanges]);
        return {
          updateOne: {
            filter: { _id: r.loan._id },
            update: { $set: { waivedRanges: merged, fineWaivedDays: fine.countRangeDays(merged), updatedAt: now } },
          },
        };
      }), { session, ordered: false });
    }
    out = {
      period: period.toObject(), applied,
      totalWaived: applied.reduce((s, r) => fine.round2(s + r.waivable), 0),
      paidNotRefunded: bulk.paidNotRefunded,
    };
  }));
  return out;
}

// Cancel: only affects live fines of loans not yet returned; returned loans keep their
// waivedRanges and existing BULK waivers stay. Transactional + epoch write (see createPeriod).
async function cancelPeriod({ periodId, reason, userId }) {
  const existing = await FinePeriod.findById(periodId).select('campusId').lean();
  if (!existing) throw new CirculationError('Period not found');
  await finePeriodModel.ensureCounter(existing.campusId);
  let doc = null;
  await withSession((session) => session.withTransaction(async () => {
    doc = null;
    await finePeriodModel.touchEpoch(existing.campusId, 'lastPeriodChangeAt', { session });
    doc = await FinePeriod.findOneAndUpdate(
      { _id: periodId, cancelled: null },
      { $set: { cancelled: { at: new Date(), by: oid(userId), reason } } },
      { new: true, session },
    ).lean();
    if (!doc) throw new CirculationError('This period is already cancelled');
  }));
  return doc;
}

module.exports = { computeBulk, preview, createPeriod, cancelPeriod };
