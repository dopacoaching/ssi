const studentModel = require('../models/studentModel');
const { logAudit } = require('../utils/audit');
const { ok, created, badRequest, forbidden, notFound } = require('../views/response');

async function listByBatch(req, res) {
  const { batchId } = req.params;
  if (req.user.role === 'TEACHER' && !req.user.batchIds.includes(batchId)) {
    return forbidden(res);
  }
  const students = await studentModel.findByBatch(batchId);
  return ok(res, students);
}

async function getOne(req, res) {
  const student = await studentModel.findById(req.params.id);
  if (!student || !student.isActive) return notFound(res, 'Student not found');
  
  if (req.user.role === 'STUDENT' && req.user.id !== student.id) {
    return forbidden(res);
  }
  
  if (req.user.role === 'TEACHER' && !req.user.batchIds.includes(student.batchId)) {
    return forbidden(res);
  }
  return ok(res, student);
}

async function create(req, res) {
  const { 
    fullName, regNumber, batchId,
    password
  } = req.body;
  if (!fullName || !regNumber || !batchId) return badRequest(res, 'Missing required fields');
  if (req.user.role === 'TEACHER' && !req.user.batchIds.includes(batchId)) {
    return forbidden(res);
  }

  const bcrypt = require('bcryptjs');
  const hashedPassword = password ? await bcrypt.hash(password, 12) : null;

  const student = await studentModel.create({
    fullName, regNumber, batchId,
    password: hashedPassword,
  });
  logAudit(req, 'CREATE', 'Student', student.id, `Created student ${student.fullName} (${student.regNumber})`);
  return created(res, student);
}

async function updatePhoto(req, res) {
  const student = await studentModel.findById(req.params.id);
  if (!student || !student.isActive) return notFound(res, 'Student not found');
  if (req.user.role === 'TEACHER' && !req.user.batchIds.includes(student.batchId)) {
    return forbidden(res);
  }
  if (!req.file) return badRequest(res, 'No image file provided');

  const updated = await studentModel.update(req.params.id, { photo: req.file.path });
  logAudit(req, 'UPDATE', 'Student', student.id, `Updated photo for ${student.fullName} (${student.regNumber})`);
  return ok(res, updated);
}

async function update(req, res) {
  const student = await studentModel.findById(req.params.id);
  if (!student || !student.isActive) return notFound(res, 'Student not found');
  
  if (req.user.role === 'STUDENT' && req.user.id !== student.id) {
    return forbidden(res);
  }
  
  if (req.user.role === 'TEACHER' && !req.user.batchIds.includes(student.batchId)) {
    return forbidden(res);
  }
  const { 
    fullName, regNumber,
    password
  } = req.body;
  
  const updateData = {};
  if (fullName       !== undefined) updateData.fullName       = fullName;
  if (regNumber      !== undefined) updateData.regNumber      = regNumber;
  
  if (password) {
    const bcrypt = require('bcryptjs');
    updateData.password = await bcrypt.hash(password, 12);
  }

  const updated = await studentModel.update(req.params.id, updateData);
  logAudit(req, 'UPDATE', 'Student', updated.id, `Updated student ${updated.fullName} (${updated.regNumber})`);
  return ok(res, updated);
}

async function remove(req, res) {
  const student = await studentModel.findById(req.params.id);
  if (!student || !student.isActive) return notFound(res, 'Student not found');
  if (req.user.role === 'TEACHER' && !req.user.batchIds.includes(student.batchId)) {
    return forbidden(res);
  }
  await studentModel.softDelete(req.params.id);
  logAudit(req, 'DELETE', 'Student', student.id, `Deactivated student ${student.fullName} (${student.regNumber})`);
  return ok(res, null, 'Student deactivated');
}

async function batchReport(req, res) {
  const { batchId } = req.params;
  if (req.user.role === 'TEACHER' && !req.user.batchIds.includes(batchId)) {
    return forbidden(res);
  }
  const data = await studentModel.findBatchReport(batchId);
  return ok(res, data);
}

async function search(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return ok(res, []);
  const batchIds = req.user.role === 'TEACHER' ? req.user.batchIds : null;
  const results = await studentModel.search(q, batchIds);
  return ok(res, results);
}

module.exports = { listByBatch, getOne, create, update, updatePhoto, remove, batchReport, search };
