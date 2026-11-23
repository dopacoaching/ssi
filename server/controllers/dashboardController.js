// Library Phase 5: dashboard widgets (one round trip).
const campusModel = require('../models/campusModel');
const loanModel = require('../models/loanModel');
const librarySettingsModel = require('../models/librarySettingsModel');
const { BookCopy, Waiver, StockCheck } = require('../models/schemas');
const finePending = require('../services/finePendingService');
const fine = require('../services/fineService');
const { ok, badRequest } = require('../views/response');
const { readScope, deny } = require('./circulationController');

const LIST_LIMIT = 10;

async function dashboard(req, res) {
  const s = readScope(req, req.query.campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'dashboard');
  const now = new Date();
  const today = fine.istDate(now);
  const isAdmin = req.library.isAdmin;

  const openList = (view) => loanModel.listOpen({ scope: s.scope, view, page: 1, limit: LIST_LIMIT, now });
  const [settings, dueToday, dueSoon, overdue, pending, byStaff, campuses] = await Promise.all([
    librarySettingsModel.get(),
    openList('dueToday'), openList('dueSoon'), openList('overdue'),
    finePending.pendingRows({ scope: s.scope, now }),
    finePending.paymentTotalsByStaff({ ...s.scope, receivedAt: finePending.dayRange(today) }),
    s.scope.campusId ? campusModel.summariesByIds([s.scope.campusId]) : new Map(),
  ]);
  const [dueTodayItems, dueSoonItems, overdueItems] = await Promise.all([
    loanModel.shapeMany(dueToday.docs, { settings, now }),
    loanModel.shapeMany(dueSoon.docs, { settings, now }),
    loanModel.shapeMany(overdue.docs, { settings, now }),
  ]);

  const students = new Set(pending.rows.map((r) => r.studentId));
  for (const [id, amount] of pending.accruingByStudent) if (amount > 0) students.add(id);

  const out = {
    campus: s.scope.campusId ? campuses.get(String(s.scope.campusId)) || null : null,
    dueToday: { count: dueToday.total, items: dueTodayItems },
    dueSoon: { count: dueSoon.total, items: dueSoonItems },
    overdue: { count: overdue.total, items: overdueItems },
    pendingFines: { balance: pending.totals.balance, accruing: pending.accruingAll, studentCount: students.size },
    todayCollection: finePending.collectionTotals(byStaff, req.user.id),
  };
  if (isAdmin) {
    const [pendingWaivers, lostCopies, damagedCopies, openStockChecks] = await Promise.all([
      Waiver.countDocuments({ ...s.scope, status: 'PENDING' }),
      BookCopy.countDocuments({ ...s.scope, status: 'LOST' }),
      BookCopy.countDocuments({ ...s.scope, status: 'DAMAGED' }),
      StockCheck.countDocuments({ ...s.scope, status: 'OPEN' }),
    ]);
    out.admin = { pendingWaivers, lostCopies, damagedCopies, openStockChecks };
  }
  return ok(res, out);
}

module.exports = { dashboard };
