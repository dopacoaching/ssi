const ceModel = require('../models/ceModel');
const studentModel = require('../models/studentModel');
const testModel = require('../models/testModel');
const prisma = require('../utils/prisma');
const { computeCE } = require('../utils/ceScoring');
const { ok, created, badRequest, forbidden, notFound } = require('../views/response');

async function isBatchLocked(studentId, month, year) {
  const student = await studentModel.findById(studentId);
  if (!student) return false;
  const approval = await prisma.batchApproval.findFirst({
    where: { batchId: student.batchId, month, year }
  });
  return !!approval;
}

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

async function aggregateTestMarks(studentId, month, year) {
  const [weekly, monthly] = await Promise.all([
    testModel.findWeeklyByStudent(studentId),
    testModel.findMonthlyByStudent(studentId),
  ]);

  const inMonth = [
    ...weekly.filter(t => {
      const d = new Date(t.weekDate);
      return (d.getMonth() + 1) === month && d.getFullYear() === year;
    }),
    ...monthly.filter(t => t.month === month && t.year === year),
  ];

  let physicsMarks = 0, physicsMax = 0;
  let chemMarks = 0,    chemMax    = 0;
  let mathMarks = 0,    mathMax    = 0;
  let bioMarks = 0,     bioMax     = 0;
  let lang1Marks = 0,   lang1Max   = 0;
  let lang2Marks = 0,   lang2Max   = 0;
  let psychologyMarks = 0, psychologyMax = 0;
  let mcqMarks = 0,     mcqMax     = 0;

  for (const t of inMonth) {
    if (t.testType === 'MCQ') {
      mcqMarks += t.marks; mcqMax += t.maxMarks;
    } else {
      switch (t.subject.toLowerCase()) {
        case 'physics':    physicsMarks += t.marks; physicsMax += t.maxMarks; break;
        case 'chemistry':  chemMarks    += t.marks; chemMax    += t.maxMarks; break;
        case 'math':       mathMarks    += t.marks; mathMax    += t.maxMarks; break;
        case 'biology':    bioMarks     += t.marks; bioMax     += t.maxMarks; break;
        case 'language 1': lang1Marks   += t.marks; lang1Max   += t.maxMarks; break;
        case 'language 2': lang2Marks   += t.marks; lang2Max   += t.maxMarks; break;
        case 'psychology':
        case 'physchology': psychologyMarks += t.marks; psychologyMax += t.maxMarks; break;
      }
    }
  }

  return {
    physicsMarks, physicsMax,
    chemMarks,    chemMax,
    mathMarks,    mathMax,
    bioMarks,     bioMax,
    lang1Marks,   lang1Max,
    lang2Marks,   lang2Max,
    psychologyMarks, psychologyMax,
    mcqMarks,     mcqMax,
  };
}

async function list(req, res) {
  const student = await guardStudent(req, res);
  if (!student) return;

  const records = await ceModel.findByStudent(req.params.id);

  const approvals = await prisma.batchApproval.findMany({
    where: { batchId: student.batchId }
  });

  const approvalSet = new Set(approvals.map(a => `${a.year}-${a.month}`));

  const mapped = records.map(r => ({
    ...r,
    isApproved: approvalSet.has(`${r.year}-${r.month}`)
  }));

  return ok(res, mapped);
}

async function upsert(req, res) {
  if (!await guardStudent(req, res)) return;

  const { month, year, attendancePct, hasMedCert = false, notesStatus } = req.body;

  if ([month, year, attendancePct, notesStatus].some(v => v == null)) {
    return badRequest(res, 'Missing required CE fields');
  }

  const m = Number(month), y = Number(year);
  if (m < 1 || m > 12) return badRequest(res, 'Month must be 1–12');
  if (y < 2000) return badRequest(res, 'Year must be 2000 or later');

  const now = new Date();
  if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) {
    return badRequest(res, 'CE record month cannot be in the future');
  }

  const isLocked = await isBatchLocked(req.params.id, m, y);
  if (req.user.role === 'TEACHER' && isLocked) {
    return forbidden(res, 'This month has been approved by admin and is locked');
  }

  const marks = await aggregateTestMarks(req.params.id, m, y);
  const mcqPct = marks.mcqMax > 0 ? (marks.mcqMarks / marks.mcqMax) * 100 : 0;

  const scores = computeCE({
    ...marks, mcqPct,
    attendancePct: Number(attendancePct),
    hasMedCert,
    notesStatus,
  });

  const payload = {
    month: m, year: y,
    ...marks, mcqPct,
    attendancePct: Number(attendancePct),
    hasMedCert,
    notesStatus,
    ...scores,
  };

  const existing = await ceModel.findOne(req.params.id, m, y);
  if (existing) {
    const updated = await ceModel.update(existing.id, payload);
    return ok(res, updated, 'CE record updated');
  }
  const record = await ceModel.create({ studentId: req.params.id, ...payload });
  return created(res, record, 'CE record created');
}

async function remove(req, res) {
  const student = await guardStudent(req, res);
  if (!student) return;

  const { ceId } = req.params;
  const existing = await ceModel.findById(ceId);
  if (!existing) return notFound(res, 'CE record not found');

  if (existing.studentId !== student.id) {
    return forbidden(res, 'Record does not belong to this student');
  }

  if (req.user.role !== 'TEACHER') {
    return forbidden(res, 'Only teachers can delete CE records');
  }

  const isLocked = await isBatchLocked(student.id, existing.month, existing.year);
  if (isLocked) {
    return forbidden(res, 'This month has been approved by admin and is locked');
  }

  await ceModel.remove(ceId);
  return ok(res, null, 'CE record deleted');
}

module.exports = { list, upsert, remove };
