const ceModel = require('../models/ceModel');
const studentModel = require('../models/studentModel');
const testModel = require('../models/testModel');
const prisma = require('../utils/prisma');
const { computeCE } = require('../utils/ceScoring');
const { logAudit } = require('../utils/audit');
const { ok, created, badRequest, forbidden, notFound } = require('../views/response');

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const VALID_NOTES_STATUSES = new Set(['COMPLETE', 'PARTIAL', 'INCOMPLETE']);

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
    testModel.findWeeklyByStudentAndMonth(studentId, month, year),
    testModel.findMonthlyByStudentAndMonth(studentId, month, year),
  ]);

  const inMonth = [...weekly, ...monthly];

  let physicsMarks = 0, physicsMax = 0;
  let chemMarks = 0,    chemMax    = 0;
  let mathMarks = 0,    mathMax    = 0;
  let bioMarks = 0,     bioMax     = 0;
  let lang1Marks = 0,   lang1Max   = 0;
  let lang2Marks = 0,   lang2Max   = 0;
  let psychologyMarks = 0, psychologyMax = 0;
  let computerScienceMarks = 0, computerScienceMax = 0;
  let mcqMarks = 0,     mcqMax     = 0;

  for (const t of inMonth) {
    if (t.testType === 'MCQ') {
      mcqMarks += t.marks; mcqMax += t.maxMarks;
    } else {
      switch (t.subject.toLowerCase()) {
        case 'physics':           physicsMarks += t.marks; physicsMax += t.maxMarks; break;
        case 'chemistry':         chemMarks    += t.marks; chemMax    += t.maxMarks; break;
        case 'math':              mathMarks    += t.marks; mathMax    += t.maxMarks; break;
        case 'biology':           bioMarks     += t.marks; bioMax     += t.maxMarks; break;
        case 'language 1':        lang1Marks   += t.marks; lang1Max   += t.maxMarks; break;
        case 'language 2':        lang2Marks   += t.marks; lang2Max   += t.maxMarks; break;
        case 'psychology':
        case 'physchology':       psychologyMarks     += t.marks; psychologyMax     += t.maxMarks; break;
        case 'computer science':  computerScienceMarks += t.marks; computerScienceMax += t.maxMarks; break;
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
    computerScienceMarks, computerScienceMax,
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
  const student = await guardStudent(req, res);
  if (!student) return;

  const { month, year, leaveDays, hasMedCert = false, notesStatus } = req.body;

  if ([month, year, leaveDays, notesStatus].some(v => v == null)) {
    return badRequest(res, 'Missing required CE fields');
  }

  if (!VALID_NOTES_STATUSES.has(notesStatus)) {
    return badRequest(res, "notesStatus must be 'COMPLETE', 'PARTIAL', or 'INCOMPLETE'");
  }

  const m = Number(month), y = Number(year);
  if (!isFinite(m) || m < 1 || m > 12) return badRequest(res, 'Month must be 1–12');
  if (!isFinite(y) || y < 2000) return badRequest(res, 'Year must be 2000 or later');
  const leave = Number(leaveDays);
  if (!Number.isInteger(leave) || leave < 0)
    return badRequest(res, 'Leave days must be a whole number of 0 or more');

  const now = new Date();
  if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) {
    return badRequest(res, 'CE record month cannot be in the future');
  }

  const isLocked = await isBatchLocked(req.params.id, m, y);
  if (req.user.role === 'TEACHER' && isLocked) {
    return forbidden(res, 'This month has been approved by admin and is locked');
  }

  // Working days are set once per batch per month; attendance can't be graded without them.
  const wdRecord = await prisma.batchWorkingDays.findFirst({
    where: { batchId: student.batchId, month: m, year: y }
  });
  if (!wdRecord) {
    return badRequest(res, `Set the total working days for this batch for ${MONTHS[m]} ${y} before recording attendance`);
  }
  const workingDays = wdRecord.workingDays;
  if (leave > workingDays) {
    return badRequest(res, `Leave days (${leave}) cannot exceed the ${workingDays} working days for ${MONTHS[m]} ${y}`);
  }

  // Derived percentage (rounded to a whole percent) kept for charts/at-risk alerts;
  // the score itself is driven by leave days.
  const att = workingDays > 0 ? Math.round(((workingDays - leave) / workingDays) * 100) : 100;

  const marks = await aggregateTestMarks(req.params.id, m, y);
  const mcqPct = marks.mcqMax > 0 ? (marks.mcqMarks / marks.mcqMax) * 100 : 0;

  const scores = computeCE({
    ...marks, mcqPct,
    leaveDays: leave,
    hasMedCert,
    notesStatus,
  });

  const payload = {
    month: m, year: y,
    ...marks, mcqPct,
    attendancePct: att,
    workingDays,
    leaveDays: leave,
    hasMedCert,
    notesStatus,
    ...scores,
  };

  const existing = await ceModel.findOne(req.params.id, m, y);
  if (existing) {
    const updated = await ceModel.update(existing.id, payload);
    logAudit(req, 'UPDATE', 'CERecord', updated.id,
      `Updated CE record ${MONTHS[m]} ${y} — ${student.fullName} (${student.regNumber}) — CE: ${scores.totalCE.toFixed(1)}/20`);
    return ok(res, updated, 'CE record updated');
  }
  const record = await ceModel.create({ studentId: req.params.id, ...payload });
  logAudit(req, 'CREATE', 'CERecord', record.id,
    `Created CE record ${MONTHS[m]} ${y} — ${student.fullName} (${student.regNumber}) — CE: ${scores.totalCE.toFixed(1)}/20`);
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

  const isLocked = await isBatchLocked(student.id, existing.month, existing.year);
  if (isLocked) {
    return forbidden(res, 'This month has been approved by admin and is locked');
  }

  await ceModel.remove(ceId);
  logAudit(req, 'DELETE', 'CERecord', ceId,
    `Deleted CE record ${MONTHS[existing.month]} ${existing.year} — ${student.fullName} (${student.regNumber})`);
  return ok(res, null, 'CE record deleted');
}

module.exports = { list, upsert, remove };
