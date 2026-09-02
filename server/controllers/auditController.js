const { AuditLog, normalize, containsInsensitive } = require('../models/schemas');
const { ok, badRequest } = require('../views/response');

const VALID_ACTIONS  = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'ERROR', 'FAILED_LOGIN'];
const VALID_ENTITIES = ['Student', 'WeeklyTest', 'MonthlyTest', 'CERecord', 'Batch', 'Teacher', 'Remark', 'BatchApproval', 'User', 'Auth', 'System'];

async function list(req, res) {
  const { page = '1', limit = '50', action, entity, search, from, to } = req.query;
  const take = Math.min(Number(limit) || 50, 100);
  const skip = (Math.max(Number(page), 1) - 1) * take;

  const where = {};
  if (action && VALID_ACTIONS.includes(action))   where.action = action;
  if (entity && VALID_ENTITIES.includes(entity))  where.entity = entity;
  if (search && search.trim()) {
    where.$or = [
      { userName:    containsInsensitive(search.trim()) },
      { description: containsInsensitive(search.trim()) },
    ];
  }
  if (from || to) {
    where.createdAt = {};
    if (from) {
      const fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) return badRequest(res, 'Invalid from date');
      where.createdAt.$gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (isNaN(toDate.getTime())) return badRequest(res, 'Invalid to date');
      toDate.setHours(23, 59, 59, 999);
      where.createdAt.$lte = toDate;
    }
  }

  const [items, total] = await Promise.all([
    AuditLog.find(where).sort({ createdAt: -1 }).skip(skip).limit(take).lean(),
    AuditLog.countDocuments(where),
  ]);

  return ok(res, { items: normalize(items), total, page: Math.max(Number(page), 1), limit: take });
}

module.exports = { list };
