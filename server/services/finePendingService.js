// Shared read-side maths for pending fines and daily collections (Phase 4 endpoints, the Phase 5
// dashboard and reports all call these). No req/res here.
const { Charge, Loan, Payment } = require('../models/schemas');
const chargeModel = require('../models/chargeModel');
const finePeriodModel = require('../models/finePeriodModel');
const fine = require('./fineService');

const OPEN_STATUSES = ['UNPAID', 'PARTIAL'];

// IST day bounds [start, nextStart) of a YYYY-MM-DD date.
const dayRange = (ymd) => ({
  $gte: new Date(`${ymd}T00:00:00+05:30`),
  $lt: new Date(`${fine.addDays(ymd, 1)}T00:00:00+05:30`),
});

// IST bounds covering the inclusive range from..to.
const rangeBounds = (from, to) => ({ $gte: dayRange(from).$gte, $lt: dayRange(to).$lt });

// Per-(student, campus) pending rows: fixed charge balances (> 0) plus live fines accruing on
// OPEN overdue loans (no-fine periods applied). `scope` = {} | { campusId };
// `studentFilter` = {} | { studentId: { $in } }.
// Returns { rows, totals: { balance, accruing } /* of rows, as the Phase 4 page shows */,
//           accruingAll /* every open overdue loan, incl. students with no fixed charges */,
//           accruingByStudent: Map<studentId, number> }.
// row = { studentId, campusId, balance, chargeCount, oldestChargeAt, accruing }, sorted by balance desc.
async function pendingRows({ scope = {}, studentFilter = {}, now = new Date() } = {}) {
  const today = fine.istDate(now);
  const [groups, openOverdue] = await Promise.all([
    Charge.aggregate([
      { $match: { ...scope, ...studentFilter, status: { $in: OPEN_STATUSES } } },
      { $addFields: { _bal: chargeModel.BALANCE_EXPR } },
      { $match: { _bal: { $gt: 0 } } },
      { $group: {
        _id: { studentId: '$studentId', campusId: '$campusId' },
        balance: { $sum: '$_bal' }, chargeCount: { $sum: 1 }, oldestChargeAt: { $min: '$createdAt' },
      } },
    ]),
    Loan.find({ ...scope, ...studentFilter, status: 'OPEN', dueDate: { $lt: today } })
      .select('campusId studentId dueDate finePerDay').lean(),
  ]);

  const periods = await finePeriodModel.loadActive(openOverdue.map((l) => l.campusId));
  const accruingBy = new Map();
  const accruingByStudent = new Map();
  let accruingAll = 0;
  for (const l of openOverdue) {
    const k = `${l.studentId}|${l.campusId}`;
    const f = fine.lateFine(l, now, { periods: periods.get(String(l.campusId)) || [] });
    accruingBy.set(k, fine.round2((accruingBy.get(k) || 0) + f));
    accruingByStudent.set(String(l.studentId), fine.round2((accruingByStudent.get(String(l.studentId)) || 0) + f));
    accruingAll = fine.round2(accruingAll + f);
  }

  const rows = groups.map((g) => ({
    studentId: String(g._id.studentId), campusId: String(g._id.campusId),
    balance: fine.round2(g.balance), chargeCount: g.chargeCount, oldestChargeAt: g.oldestChargeAt,
    accruing: accruingBy.get(`${g._id.studentId}|${g._id.campusId}`) || 0,
  }));
  rows.sort((a, b) => b.balance - a.balance || b.accruing - a.accruing || a.studentId.localeCompare(b.studentId));
  const totals = rows.reduce((t, r) => ({
    balance: fine.round2(t.balance + r.balance), accruing: fine.round2(t.accruing + r.accruing),
  }), { balance: 0, accruing: 0 });
  return { rows, totals, accruingAll, accruingByStudent };
}

// Non-voided payment totals grouped by receiving staff: Map<userId, { total, count }>.
// `filter` already carries scope + receivedAt bounds.
async function paymentTotalsByStaff(filter) {
  const rows = await Payment.aggregate([
    { $match: { ...filter, voided: null } },
    { $group: { _id: '$receivedBy', total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((e) => [String(e._id), { total: fine.round2(e.total), count: e.count }]));
}

// { myTotal, myCount, campusTotal, campusCount } from the map above.
function collectionTotals(byStaffMap, userId) {
  const sum = (entries) => entries.reduce((t, e) => fine.round2(t + e.total), 0);
  const cnt = (entries) => entries.reduce((t, e) => t + e.count, 0);
  const mine = byStaffMap.has(String(userId)) ? [byStaffMap.get(String(userId))] : [];
  const all = [...byStaffMap.values()];
  return { myTotal: sum(mine), myCount: cnt(mine), campusTotal: sum(all), campusCount: cnt(all) };
}

module.exports = { OPEN_STATUSES, dayRange, rangeBounds, pendingRows, paymentTotalsByStaff, collectionTotals };
