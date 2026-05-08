const prisma = require('../utils/prisma');
const { ok } = require('../views/response');

const VALID_ACTIONS  = ['CREATE', 'UPDATE', 'DELETE'];
const VALID_ENTITIES = ['Student', 'WeeklyTest', 'MonthlyTest', 'CERecord', 'Batch', 'Teacher', 'Remark', 'BatchApproval'];

async function list(req, res) {
  const { page = '1', limit = '50', action, entity, search, from, to } = req.query;
  const take = Math.min(Number(limit) || 50, 100);
  const skip = (Math.max(Number(page), 1) - 1) * take;

  const where = {};
  if (action && VALID_ACTIONS.includes(action))   where.action = action;
  if (entity && VALID_ENTITIES.includes(entity))  where.entity = entity;
  if (search && search.trim()) {
    where.OR = [
      { userName:    { contains: search.trim(), mode: 'insensitive' } },
      { description: { contains: search.trim(), mode: 'insensitive' } },
    ];
  }
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to)   where.createdAt.lte = new Date(new Date(to).setHours(23, 59, 59, 999));
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.auditLog.count({ where }),
  ]);

  return ok(res, { items, total, page: Math.max(Number(page), 1), limit: take });
}

module.exports = { list };
