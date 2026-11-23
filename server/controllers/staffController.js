const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const userModel = require('../models/userModel');
const campusModel = require('../models/campusModel');
const { logAudit } = require('../utils/audit');
const { ok, created, badRequest, notFound } = require('../views/response');

const ROLES = userModel.STAFF_ROLES; // ['TEACHER', 'LIBRARIAN']

// Validates a libraryCampusId value. Returns { campus } or { error }.
// `currentCampusId` lets an unchanged (possibly since-deactivated) campus pass.
async function resolveLibraryCampus(value, currentCampusId = null) {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) return { error: 'Invalid library campus' };
  const campus = await campusModel.findById(value);
  if (!campus) return { error: 'Library campus not found' };
  if (!campus.isActive && String(currentCampusId) !== campus.id) return { error: 'Library campus is inactive' };
  return { campus };
}

function validBatchIds(batchIds) {
  return Array.isArray(batchIds) && batchIds.every((b) => typeof b === 'string' && mongoose.isValidObjectId(b));
}

async function listStaff(req, res) {
  return ok(res, await userModel.findAllStaff());
}

async function createStaff(req, res) {
  const body = req.body || {};
  const email = (typeof body.email === 'string' ? body.email : '').trim();
  const name  = (typeof body.name  === 'string' ? body.name  : '').trim();
  const { password, role } = body;
  const batchIds = body.batchIds === undefined ? [] : body.batchIds;
  const hasCampus = body.libraryCampusId !== undefined && body.libraryCampusId !== null && body.libraryCampusId !== '';

  if (!email || !password || !name) return badRequest(res, 'Username/Email, password, and name required');
  if (typeof password !== 'string' || password.length < 8) return badRequest(res, 'Password must be at least 8 characters');
  if (!ROLES.includes(role)) return badRequest(res, 'Role must be TEACHER or LIBRARIAN');
  if (!validBatchIds(batchIds)) return badRequest(res, 'batchIds must be an array of batch ids');
  if (role === 'LIBRARIAN' && batchIds.length > 0) return badRequest(res, 'Library staff cannot be assigned to batches');
  if (role === 'LIBRARIAN' && !hasCampus) return badRequest(res, 'Library campus is required for library staff');

  let campus = null;
  if (hasCampus) {
    const r = await resolveLibraryCampus(body.libraryCampusId);
    if (r.error) return badRequest(res, r.error);
    campus = r.campus;
  }

  const exists = await userModel.findByEmail(email);
  if (exists) return badRequest(res, 'Username/Email already registered');

  const hashed = await bcrypt.hash(password, 12);
  const user = await userModel.create({
    email, password: hashed, name, role,
    batchIds: role === 'LIBRARIAN' ? [] : batchIds,
    libraryCampusId: campus ? campus.id : null,
  });
  const [staff] = await userModel.toStaff([user]);
  logAudit(req, 'CREATE', 'User', user.id,
    `Created ${role.toLowerCase()} "${user.name}" (${user.email})${campus ? ` with library access to campus "${campus.name}"` : ''}`);
  return created(res, staff);
}

async function updateStaff(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return notFound(res, 'Staff member not found');
  const existing = await userModel.findById(req.params.id);
  if (!existing || !ROLES.includes(existing.role)) return notFound(res, 'Staff member not found');

  const body = req.body || {};
  const { name, role, batchIds, isActive, password, libraryCampusId } = body;

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) return badRequest(res, 'Name cannot be empty');
  if (password !== undefined && password !== null && password !== '' && (typeof password !== 'string' || password.length < 8)) {
    return badRequest(res, 'Password must be at least 8 characters');
  }
  if (role !== undefined && !ROLES.includes(role)) return badRequest(res, 'Role must be TEACHER or LIBRARIAN');
  if (batchIds !== undefined && !validBatchIds(batchIds)) return badRequest(res, 'batchIds must be an array of batch ids');
  if (isActive !== undefined && typeof isActive !== 'boolean') return badRequest(res, 'isActive must be a boolean');

  const newRole = role !== undefined ? role : existing.role;
  const clearCampus = libraryCampusId === null || libraryCampusId === '';

  let campus = null;
  if (libraryCampusId !== undefined && !clearCampus) {
    const r = await resolveLibraryCampus(libraryCampusId, existing.libraryCampusId);
    if (r.error) return badRequest(res, r.error);
    campus = r.campus;
  }

  // A LIBRARIAN -> TEACHER change drops library access unless the request explicitly grants it
  // (teacher library access is always an explicit admin decision).
  const demotedLibrarian = existing.role === 'LIBRARIAN' && newRole !== 'LIBRARIAN';
  const resultingCampusId = libraryCampusId === undefined
    ? (demotedLibrarian ? null : (existing.libraryCampusId || null))
    : (clearCampus ? null : campus.id);
  const campusChanged = resultingCampusId !== (existing.libraryCampusId || null);

  if (newRole === 'LIBRARIAN') {
    if (batchIds !== undefined && batchIds.length > 0) return badRequest(res, 'Library staff cannot be assigned to batches');
    if (!resultingCampusId) return badRequest(res, 'Library campus is required for library staff');
  }

  const data = {};
  if (name !== undefined)  data.name = name.trim();
  if (role !== undefined)  data.role = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (password)            data.password = await bcrypt.hash(password, 12);
  if (libraryCampusId !== undefined || campusChanged) data.libraryCampusId = resultingCampusId;
  if (newRole === 'LIBRARIAN') {
    if (batchIds !== undefined || existing.role !== 'LIBRARIAN' || (existing.batchIds || []).length > 0) data.batchIds = [];
  } else if (batchIds !== undefined) {
    data.batchIds = batchIds;
  }

  const updated = await userModel.update(req.params.id, data);
  const [staff] = await userModel.toStaff([updated]);

  const changes = [];
  if (data.name !== undefined && data.name !== existing.name) changes.push(`name -> "${data.name}"`);
  if (data.role !== undefined && data.role !== existing.role) changes.push(`role ${existing.role} -> ${data.role}`);
  if (batchIds !== undefined && newRole !== 'LIBRARIAN') changes.push('batches updated');
  if (data.batchIds && newRole === 'LIBRARIAN' && (existing.batchIds || []).length > 0) changes.push('batches cleared');
  if (campusChanged) {
    changes.push(resultingCampusId ? `library campus -> "${campus.name}"` : 'library access removed');
  }
  if (isActive !== undefined && isActive !== existing.isActive) changes.push(isActive ? 'reactivated' : 'deactivated');
  if (password) changes.push('password reset');
  logAudit(req, 'UPDATE', 'User', existing.id,
    `Updated ${existing.role.toLowerCase()} "${existing.name}": ${changes.join(', ') || 'no changes'}`);
  return ok(res, staff);
}

module.exports = { listStaff, createStaff, updateStaff };
