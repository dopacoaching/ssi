const remarkModel = require('../models/remarkModel');
const studentModel = require('../models/studentModel');
const { ok, created, badRequest, forbidden, notFound } = require('../views/response');


async function guardStudent(req, res) {
  const student = await studentModel.findById(req.params.id);
  if (!student || !student.isActive) { notFound(res, 'Student not found'); return null; }

  if (req.user.role === 'STUDENT' && req.user.id !== student.id) {
    forbidden(res); return null;
  }

  if (req.user.role === 'TEACHER' && !req.user.batchIds.includes(student.batchId)) {
    forbidden(res); return null;
  }
  return student;
}

async function list(req, res) {
  if (!await guardStudent(req, res)) return;
  const remarks = await remarkModel.findByStudent(req.params.id);
  return ok(res, remarks);
}

async function add(req, res) {
  if (!await guardStudent(req, res)) return;
  const { category, text, isFlagged = false } = req.body;
  if (!category || !text) return badRequest(res, 'Category and text required');
  const remark = await remarkModel.create({
    studentId: req.params.id,
    teacherId: req.user.id,
    category, text, isFlagged,
  });
  return created(res, remark);
}

async function flag(req, res) {
  if (!await guardStudent(req, res)) return;
  const { remarkId } = req.params;
  const existing = await remarkModel.findById(remarkId);
  if (!existing) return notFound(res, 'Remark not found');
  const remark = await remarkModel.update(remarkId, { isFlagged: !existing.isFlagged });
  return ok(res, remark);
}

module.exports = { list, add, flag };
