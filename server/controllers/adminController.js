const bcrypt = require('bcryptjs');
const batchModel = require('../models/batchModel');
const userModel = require('../models/userModel');
const studentModel = require('../models/studentModel');
const prisma = require('../utils/prisma');
const { logAudit } = require('../utils/audit');
const { ok, created, badRequest, forbidden, notFound } = require('../views/response');

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Batches
async function listBatches(req, res) {
  const batches = await batchModel.findAll();
  return ok(res, batches);
}

async function createBatch(req, res) {
  const { name, year } = req.body;
  if (!name || !year) return badRequest(res, 'Name and year required');
  const batch = await batchModel.create({ name, year: Number(year) });
  logAudit(req, 'CREATE', 'Batch', batch.id, `Created batch "${batch.name}" (${batch.year})`);
  return created(res, batch);
}

async function updateBatch(req, res) {
  const batch = await batchModel.findById(req.params.id);
  if (!batch) return notFound(res, 'Batch not found');
  const { name, year } = req.body;
  const updated = await batchModel.update(req.params.id, { name, year: year ? Number(year) : undefined });
  logAudit(req, 'UPDATE', 'Batch', updated.id, `Updated batch "${updated.name}"`);
  return ok(res, updated);
}

// Teachers
async function listTeachers(req, res) {
  const teachers = await userModel.findAll();
  return ok(res, teachers.filter(u => u.role === 'TEACHER'));
}

async function createTeacher(req, res) {
  const { email, password, name, batchIds = [] } = req.body;
  if (!email || !password || !name) return badRequest(res, 'Username/Email, password, and name required');
  if (password.length < 8) return badRequest(res, 'Password must be at least 8 characters');
  const exists = await userModel.findByEmail(email);
  if (exists) return badRequest(res, 'Username/Email already registered');
  const hashed = await bcrypt.hash(password, 12);
  const teacher = await userModel.create({ email, password: hashed, name, role: 'TEACHER', batchIds });
  logAudit(req, 'CREATE', 'Teacher', teacher.id, `Created teacher "${teacher.name}" (${teacher.email})`);
  return created(res, { id: teacher.id, email: teacher.email, name: teacher.name, batchIds: teacher.batchIds });
}

async function updateTeacher(req, res) {
  const existing = await userModel.findById(req.params.id);
  if (!existing || existing.role !== 'TEACHER') return notFound(res, 'Teacher not found');
  const { name, batchIds, isActive, password } = req.body;
  if (password && password.length < 8) return badRequest(res, 'Password must be at least 8 characters');
  if (batchIds !== undefined && !Array.isArray(batchIds))
    return badRequest(res, 'batchIds must be an array');
  if (isActive !== undefined && typeof isActive !== 'boolean')
    return badRequest(res, 'isActive must be a boolean');
  const data = {};
  if (name      !== undefined) data.name      = name;
  if (batchIds  !== undefined) data.batchIds  = batchIds;
  if (isActive  !== undefined) data.isActive  = isActive;
  if (password)                data.password  = await bcrypt.hash(password, 12);
  const updated = await userModel.update(req.params.id, data);
  const changes = [];
  if (name      !== undefined) changes.push(`name → "${name}"`);
  if (batchIds  !== undefined) changes.push('batches updated');
  if (isActive  !== undefined) changes.push(isActive ? 'reactivated' : 'deactivated');
  if (password)                changes.push('password reset');
  logAudit(req, 'UPDATE', 'Teacher', existing.id,
    `Updated teacher "${existing.name}": ${changes.join(', ') || 'no changes'}`);
  return ok(res, { id: updated.id, email: updated.email, name: updated.name, batchIds: updated.batchIds, isActive: updated.isActive });
}

// All students (admin)
async function listAllStudents(req, res) {
  const students = await studentModel.findAllActive();
  return ok(res, students);
}

async function batchAnalytics(req, res) {
  const batch = await batchModel.findById(req.params.id);
  if (!batch) return notFound(res, 'Batch not found');

  if (req.user.role === 'TEACHER' && !req.user.batchIds.includes(req.params.id)) {
    return forbidden(res);
  }

  const students = await prisma.student.findMany({
    where: { batchId: req.params.id, isActive: true },
    select: {
      id: true, fullName: true, regNumber: true,
      ceRecords: { orderBy: [{ year: 'asc' }, { month: 'asc' }] },
    },
    orderBy: { regNumber: 'asc' },
  });

  const monthMap = {};
  students.forEach(s => {
    s.ceRecords.forEach(r => {
      const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
      if (!monthMap[key]) monthMap[key] = { month: r.month, year: r.year, ceTotal: 0, attTotal: 0, count: 0 };
      monthMap[key].ceTotal  += r.totalCE;
      monthMap[key].attTotal += r.attendancePct;
      monthMap[key].count++;
    });
  });
  const ceMonthly = Object.values(monthMap)
    .map(m => ({ month: m.month, year: m.year, avgCE: m.ceTotal / m.count, avgAttendance: m.attTotal / m.count, studentCount: m.count }))
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  const subKeys = ['physics', 'chem', 'math', 'bio', 'lang1', 'lang2', 'psychology', 'computerScience'];
  const subSums = Object.fromEntries(subKeys.map(k => [k, { total: 0, count: 0 }]));
  students.forEach(s => {
    s.ceRecords.forEach(r => {
      subKeys.forEach(k => {
        const marks = r[`${k}Marks`], max = r[`${k}Max`];
        if (max > 0) { subSums[k].total += (marks / max) * 100; subSums[k].count++; }
      });
    });
  });
  const subjectAverages = Object.fromEntries(
    subKeys.map(k => [k, subSums[k].count > 0 ? subSums[k].total / subSums[k].count : 0])
  );

  const studentStats = students.map(s => {
    const count = s.ceRecords.length;
    const avgCE  = count > 0 ? s.ceRecords.reduce((a, r) => a + r.totalCE, 0)      / count : 0;
    const avgAtt = count > 0 ? s.ceRecords.reduce((a, r) => a + r.attendancePct, 0) / count : 0;
    return { id: s.id, fullName: s.fullName, regNumber: s.regNumber, avgCE, avgAttendance: avgAtt, ceCount: count };
  });

  const topStudents = [...studentStats].filter(s => s.ceCount > 0).sort((a, b) => b.avgCE - a.avgCE).slice(0, 5);
  const atRisk      = studentStats.filter(s => s.ceCount > 0 && (s.avgCE < 10 || s.avgAttendance < 90));

  return ok(res, { batch: { id: batch.id, name: batch.name }, studentCount: students.length, ceMonthly, subjectAverages, topStudents, atRisk });
}

async function alerts(req, res) {
  const batchIds = req.user.role === 'TEACHER' ? req.user.batchIds : null;
  const students = await studentModel.findAllWithLatestCE(batchIds);
  const atRisk = students
    .filter(s => {
      const latest = s.ceRecords[0];
      if (!latest) return false;
      return latest.totalCE < 10 || latest.attendancePct < 90;
    })
    .map(s => ({ id: s.id, fullName: s.fullName, regNumber: s.regNumber, batch: s.batch, latestCE: s.ceRecords[0], prevCE: s.ceRecords[1] || null }));
  return ok(res, atRisk);
}

async function listBatchApprovals(req, res) {
  const { id } = req.params;
  const approvals = await prisma.batchApproval.findMany({
    where: { batchId: id },
    orderBy: [{ year: 'desc' }, { month: 'desc' }]
  });
  return ok(res, approvals);
}

async function toggleBatchApproval(req, res) {
  const { id } = req.params;
  const { month, year, isApproved } = req.body;

  if (month == null || year == null) {
    return badRequest(res, 'Month and year are required');
  }

  const m = Number(month);
  const y = Number(year);

  const batchInfo = await batchModel.findById(id);
  const batchName = batchInfo?.name || id;

  if (isApproved) {
    const approval = await prisma.batchApproval.upsert({
      where: { batchId_month_year: { batchId: id, month: m, year: y } },
      create: { batchId: id, month: m, year: y },
      update: {}
    });
    logAudit(req, 'CREATE', 'BatchApproval', id,
      `Locked batch "${batchName}" for ${MONTHS[m]} ${y}`);
    return ok(res, approval, 'Batch approved and locked');
  } else {
    await prisma.batchApproval.deleteMany({
      where: { batchId: id, month: m, year: y }
    });
    logAudit(req, 'DELETE', 'BatchApproval', id,
      `Unlocked batch "${batchName}" for ${MONTHS[m]} ${y}`);
    return ok(res, null, 'Batch unlocked');
  }
}

async function transferStudents(req, res) {
  const { studentIds, targetBatchId } = req.body;

  if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
    return badRequest(res, 'No students selected for transfer');
  }

  if (!targetBatchId) {
    return badRequest(res, 'Target batch is required');
  }

  const targetBatch = await batchModel.findById(targetBatchId);
  if (!targetBatch) {
    return notFound(res, 'Target batch not found');
  }

  await prisma.student.updateMany({
    where: { id: { in: studentIds } },
    data: { batchId: targetBatchId }
  });

  logAudit(req, 'UPDATE', 'Student', '', `Transferred ${studentIds.length} student(s) to batch "${targetBatch.name}"`);
  return ok(res, null, `${studentIds.length} students transferred successfully`);
}

module.exports = {
  listBatches,
  createBatch,
  updateBatch,
  listTeachers,
  createTeacher,
  updateTeacher,
  listAllStudents,
  batchAnalytics,
  alerts,
  listBatchApprovals,
  toggleBatchApproval,
  transferStudents
};
