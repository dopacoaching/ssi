const { AuditLog } = require('../models/schemas');

async function logAudit(req, action, entity, entityId, description) {
  try {
    await AuditLog.create({
      userId:   req.user?.id   ?? null,
      userName: req.user?.name ?? null,
      userRole: req.user?.role ?? null,
      action,
      entity,
      entityId: entityId || '',
      description,
    });
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

// Batched variant: entries = [{ action, entity, entityId, description }].
// Same fields as logAudit; errors are swallowed.
async function logAuditMany(req, entries) {
  if (!entries || entries.length === 0) return;
  try {
    const docs = entries.map((e) => ({
      userId:   req.user?.id   ?? null,
      userName: req.user?.name ?? null,
      userRole: req.user?.role ?? null,
      action:   e.action,
      entity:   e.entity,
      entityId: e.entityId ? String(e.entityId) : '',
      description: e.description,
    }));
    await AuditLog.insertMany(docs, { ordered: false });
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

async function logError(req, statusCode, message) {
  try {
    const method = req?.method || '';
    const path   = req?.originalUrl || '';
    await AuditLog.create({
      userId:   req?.user?.id   ?? null,
      userName: req?.user?.name ?? null,
      userRole: req?.user?.role ?? null,
      action:      'ERROR',
      entity:      'System',
      entityId:    '',
      description: `${statusCode} ${method} ${path} — ${message}`,
    });
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

async function logFailedLogin(identifier, reason) {
  try {
    await AuditLog.create({
      userId:   null,
      userName: null,
      userRole: null,
      action:      'FAILED_LOGIN',
      entity:      'Auth',
      entityId:    '',
      description: `Failed login for "${identifier}" — ${reason}`,
    });
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

module.exports = { logAudit, logAuditMany, logError, logFailedLogin };
