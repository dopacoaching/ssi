const prisma = require('./prisma');

async function logAudit(req, action, entity, entityId, description) {
  try {
    await prisma.auditLog.create({
      data: {
        userId:      req.user.id,
        userName:    req.user.name,
        userRole:    req.user.role,
        action,
        entity,
        entityId:    entityId || '',
        description,
      },
    });
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

module.exports = { logAudit };
