const prisma = require('./prisma');

async function logAudit(req, action, entity, entityId, description) {
  try {
    await prisma.auditLog.create({
      data: {
        userId:      req.user?.id   ?? null,
        userName:    req.user?.name ?? null,
        userRole:    req.user?.role ?? null,
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

async function logError(req, statusCode, message) {
  try {
    const method = req?.method || '';
    const path   = req?.originalUrl || '';
    await prisma.auditLog.create({
      data: {
        userId:      req?.user?.id   ?? null,
        userName:    req?.user?.name ?? null,
        userRole:    req?.user?.role ?? null,
        action:      'ERROR',
        entity:      'System',
        entityId:    '',
        description: `${statusCode} ${method} ${path} — ${message}`,
      },
    });
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

async function logFailedLogin(identifier, reason) {
  try {
    await prisma.auditLog.create({
      data: {
        userId:      null,
        userName:    null,
        userRole:    null,
        action:      'FAILED_LOGIN',
        entity:      'Auth',
        entityId:    '',
        description: `Failed login for "${identifier}" — ${reason}`,
      },
    });
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

module.exports = { logAudit, logError, logFailedLogin };
