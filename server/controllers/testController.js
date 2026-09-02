const testModel = require("../models/testModel");
const studentModel = require("../models/studentModel");
const ceModel = require("../models/ceModel");
const { WeeklyTest, MonthlyTest, BatchApproval, Student } = require("../models/schemas");
const { computeCE } = require("../utils/ceScoring");
const {
  ok,
  created,
  badRequest,
  forbidden,
  notFound,
} = require("../views/response");
const { logAudit } = require("../utils/audit");

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function isLocked(studentId, month, year, userRole) {
  if (userRole !== "TEACHER") return false;
  const student = await studentModel.findById(studentId);
  if (!student) return false;
  const approval = await BatchApproval.findOne({ batchId: student.batchId, month, year }).lean();
  return !!approval;
}

async function syncCEForMonth(studentId, month, year) {
  const [weeklyInMonth, monthlyInMonth] = await Promise.all([
    WeeklyTest.find({
      studentId,
      weekDate: {
        $gte: new Date(year, month - 1, 1),
        $lt:  new Date(year, month,     1),
      },
    }).lean(),
    MonthlyTest.find({ studentId, month, year }).lean(),
  ]);

  const allTests = [...weeklyInMonth, ...monthlyInMonth];

  let physicsMarks = 0,
    physicsMax = 0;
  let chemMarks = 0,
    chemMax = 0;
  let mathMarks = 0,
    mathMax = 0;
  let bioMarks = 0,
    bioMax = 0;
  let lang1Marks = 0,
    lang1Max = 0;
  let lang2Marks = 0,
    lang2Max = 0;
  let psychologyMarks = 0,
    psychologyMax = 0;
  let computerScienceMarks = 0,
    computerScienceMax = 0;
  let mcqMarks = 0,
    mcqMax = 0;

  for (const t of allTests) {
    if (t.testType === "MCQ") {
      mcqMarks += t.marks;
      mcqMax += t.maxMarks;
    } else {
      switch (t.subject.toLowerCase()) {
        case "physics":
          physicsMarks += t.marks;
          physicsMax += t.maxMarks;
          break;
        case "chemistry":
          chemMarks += t.marks;
          chemMax += t.maxMarks;
          break;
        case "math":
          mathMarks += t.marks;
          mathMax += t.maxMarks;
          break;
        case "biology":
          bioMarks += t.marks;
          bioMax += t.maxMarks;
          break;
        case "language 1":
          lang1Marks += t.marks;
          lang1Max += t.maxMarks;
          break;
        case "language 2":
          lang2Marks += t.marks;
          lang2Max += t.maxMarks;
          break;
        case "psychology":
        case "physchology":
          psychologyMarks += t.marks;
          psychologyMax += t.maxMarks;
          break;
        case "computer science":
          computerScienceMarks += t.marks;
          computerScienceMax += t.maxMarks;
          break;
      }
    }
  }

  const existing = await ceModel.findOne(studentId, month, year);

  const payload = {
    month,
    year,
    physicsMarks,
    physicsMax,
    chemMarks,
    chemMax,
    mathMarks,
    mathMax,
    bioMarks,
    bioMax,
    lang1Marks,
    lang1Max,
    lang2Marks,
    lang2Max,
    psychologyMarks,
    psychologyMax,
    computerScienceMarks,
    computerScienceMax,
    mcqMarks,
    mcqMax,
    mcqPct: mcqMax > 0 ? (mcqMarks / mcqMax) * 100 : 0,
    // No attendance recorded yet → assume full attendance (0 leaves), matching the
    // leave-based scoring default, so the attendance % and attendance marks stay consistent.
    attendancePct: existing ? existing.attendancePct : 100,
    workingDays: existing ? existing.workingDays : 0,
    leaveDays: existing ? existing.leaveDays : 0,
    hasMedCert: existing ? existing.hasMedCert : false,
    notesStatus: existing ? existing.notesStatus : "INCOMPLETE",
  };

  const scores = computeCE(payload);
  const finalData = { ...payload, ...scores };

  if (existing) {
    await ceModel.update(existing.id, finalData);
  } else {
    await ceModel.create({ studentId, ...finalData });
  }
}

async function guardStudent(req, res) {
  const student = await studentModel.findById(req.params.id);
  if (!student || !student.isActive) {
    notFound(res, "Student not found");
    return null;
  }

  if (req.user.role === "STUDENT" && req.user.id !== student.id) {
    forbidden(res);
    return null;
  }

  if (
    req.user.role === "TEACHER" &&
    !req.user.batchIds.includes(student.batchId)
  ) {
    forbidden(res);
    return null;
  }
  return student;
}

async function listWeekly(req, res) {
  if (!(await guardStudent(req, res))) return;
  const tests = await testModel.findWeeklyByStudent(req.params.id);
  return ok(res, tests);
}

const VALID_TEST_TYPES   = new Set(['Theory', 'MCQ']);
const VALID_SUBJECTS     = new Set(['physics', 'chemistry', 'math', 'biology', 'language 1', 'language 2', 'psychology', 'computer science']);

async function addWeekly(req, res) {
  const student = await guardStudent(req, res);
  if (!student) return;
  const { weekDate, testType, subject, chapter, marks, maxMarks } = req.body;
  if (!weekDate || !subject || marks == null || !maxMarks)
    return badRequest(res, "Missing fields");
  if (testType !== undefined && !VALID_TEST_TYPES.has(testType))
    return badRequest(res, "testType must be 'Theory' or 'MCQ'");
  const effectiveType = testType || 'Theory';
  if (effectiveType !== 'MCQ' && !VALID_SUBJECTS.has(subject.toLowerCase()))
    return badRequest(res, `subject must be one of: Physics, Chemistry, Math, Biology, Language 1, Language 2, Psychology, Computer Science`);
  if (Number(maxMarks) <= 0)
    return badRequest(res, "maxMarks must be positive");
  if (!isFinite(Number(marks)) || Number(marks) < 0)
    return badRequest(res, "marks must be a non-negative number");
  if (Number(marks) > Number(maxMarks))
    return badRequest(res, "marks cannot exceed maxMarks");
  const d = new Date(weekDate);
  if (isNaN(d.getTime())) return badRequest(res, 'Invalid weekDate format');
  if (
    await isLocked(
      req.params.id,
      d.getMonth() + 1,
      d.getFullYear(),
      req.user.role,
    )
  ) {
    return forbidden(
      res,
      "This month has been approved by admin and is locked",
    );
  }
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (d > today) return badRequest(res, "Test date cannot be in the future");

  const dup = await testModel.findWeeklyDuplicate(
    req.params.id,
    subject,
    testType || "Theory",
    d,
  );
  if (dup)
    return badRequest(
      res,
      `A ${testType || "Theory"} test for ${subject} on this date already exists`,
    );

  const test = await testModel.createWeekly({
    studentId: req.params.id,
    weekDate: d,
    testType: testType || "Theory",
    subject,
    chapter: chapter || "",
    marks: Number(marks),
    maxMarks: Number(maxMarks),
  });

  await syncCEForMonth(req.params.id, d.getMonth() + 1, d.getFullYear());
  logAudit(req, 'CREATE', 'WeeklyTest', test.id,
    `Added ${test.testType} ${test.subject} — ${student.fullName} (${student.regNumber}) — ${test.marks}/${test.maxMarks} on ${weekDate}`);

  return created(res, test);
}

async function listMonthly(req, res) {
  if (!(await guardStudent(req, res))) return;
  const tests = await testModel.findMonthlyByStudent(req.params.id);
  return ok(res, tests);
}

async function addMonthly(req, res) {
  const student = await guardStudent(req, res);
  if (!student) return;
  const { month, year, testType, subject, marks, maxMarks } = req.body;
  if (!month || !year || !subject || marks == null || !maxMarks)
    return badRequest(res, "Missing fields");
  if (testType !== undefined && !VALID_TEST_TYPES.has(testType))
    return badRequest(res, "testType must be 'Theory' or 'MCQ'");
  const effectiveType = testType || 'Theory';
  if (effectiveType !== 'MCQ' && !VALID_SUBJECTS.has(subject.toLowerCase()))
    return badRequest(res, `subject must be one of: Physics, Chemistry, Math, Biology, Language 1, Language 2, Psychology, Computer Science`);
  if (Number(maxMarks) <= 0)
    return badRequest(res, "maxMarks must be positive");
  if (!isFinite(Number(marks)) || Number(marks) < 0)
    return badRequest(res, "marks must be a non-negative number");
  if (Number(marks) > Number(maxMarks))
    return badRequest(res, "marks cannot exceed maxMarks");
  const now = new Date();
  const m = Number(month),
    y = Number(year);
  if (await isLocked(req.params.id, m, y, req.user.role)) {
    return forbidden(
      res,
      "This month has been approved by admin and is locked",
    );
  }
  if (
    y > now.getFullYear() ||
    (y === now.getFullYear() && m > now.getMonth() + 1)
  ) {
    return badRequest(res, "Test month cannot be in the future");
  }

  const dup = await testModel.findMonthlyDuplicate(
    req.params.id,
    subject,
    testType || "Theory",
    m,
    y,
  );
  if (dup)
    return badRequest(
      res,
      `A ${testType || "Theory"} test for ${subject} in this month already exists`,
    );

  const test = await testModel.createMonthly({
    studentId: req.params.id,
    month: m,
    year: y,
    testType: testType || "Theory",
    subject,
    marks: Number(marks),
    maxMarks: Number(maxMarks),
  });

  await syncCEForMonth(req.params.id, m, y);
  logAudit(req, 'CREATE', 'MonthlyTest', test.id,
    `Added ${test.testType} ${test.subject} — ${student.fullName} (${student.regNumber}) — ${test.marks}/${test.maxMarks} (${MONTHS[m]} ${y})`);

  return created(res, test);
}

async function bulkAdd(req, res) {
  const { batchId } = req.params;
  if (req.user.role === "TEACHER" && !req.user.batchIds.includes(batchId)) {
    return forbidden(res);
  }
  const {
    isWeekly,
    testType,
    subject,
    weekDate,
    month,
    year,
    maxMarks,
    chapter,
    entries,
  } = req.body;
  if (!Array.isArray(entries) || entries.length === 0)
    return badRequest(res, "No entries provided");
  if (!subject || maxMarks == null)
    return badRequest(res, "subject and maxMarks required");
  if (testType !== undefined && !VALID_TEST_TYPES.has(testType))
    return badRequest(res, "testType must be 'Theory' or 'MCQ'");
  const effectiveType = testType || 'Theory';
  if (effectiveType !== 'MCQ' && !VALID_SUBJECTS.has(subject.toLowerCase()))
    return badRequest(res, `subject must be one of: Physics, Chemistry, Math, Biology, Language 1, Language 2, Psychology, Computer Science`);
  if (Number(maxMarks) <= 0)
    return badRequest(res, "maxMarks must be positive");
  if (!isFinite(Number(maxMarks)))
    return badRequest(res, "maxMarks must be a finite number");
  for (const entry of entries) {
    if (entry.marks == null) continue;
    if (!isFinite(Number(entry.marks)) || Number(entry.marks) < 0)
      return badRequest(res, `Invalid marks for student ${entry.studentId}`);
    if (Number(entry.marks) > Number(maxMarks))
      return badRequest(res, `marks exceed maxMarks for student ${entry.studentId}`);
  }

  // Verify every studentId in entries belongs to this batch (critical auth check)
  const entryStudentIds = entries.filter(e => e.marks != null).map(e => e.studentId);
  const batchStudents = await Student.find({
    _id: { $in: entryStudentIds }, batchId, isActive: true,
  }).select('_id').lean();
  const validStudentIds = new Set(batchStudents.map(s => String(s._id)));

  let createdCount = 0,
    skippedCount = 0;
  const affectedStudents = new Set();

  if (isWeekly) {
    if (!weekDate) return badRequest(res, "weekDate required for weekly tests");
    const d = new Date(weekDate);
    if (isNaN(d.getTime())) return badRequest(res, 'Invalid weekDate format');
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (d > today) return badRequest(res, "Test date cannot be in the future");
    const targetMonth = d.getMonth() + 1,
      targetYear = d.getFullYear();

    // Check batch lock once (all entries share the same batchId)
    if (req.user.role === "TEACHER") {
      const approval = await BatchApproval.findOne({
        batchId, month: targetMonth, year: targetYear,
      }).lean();
      if (approval) {
        return forbidden(res, "This month has been approved by admin and is locked");
      }
    }

    // Batch-fetch existing duplicates for all students in one query
    const studentIds = entries.filter(e => e.marks != null).map(e => e.studentId);
    const existingWeekly = await WeeklyTest.find({
      studentId: { $in: studentIds },
      subject,
      testType: testType || "Theory",
      weekDate: d,
    }).select('studentId').lean();
    const duplicateSet = new Set(existingWeekly.map(t => String(t.studentId)));

    for (const entry of entries) {
      if (entry.marks == null) continue;
      if (!validStudentIds.has(entry.studentId)) { skippedCount++; continue; }
      if (duplicateSet.has(entry.studentId)) {
        skippedCount++;
        continue;
      }
      await testModel.createWeekly({
        studentId: entry.studentId,
        weekDate: d,
        testType: testType || "Theory",
        subject,
        chapter: chapter || "",
        marks: Number(entry.marks),
        maxMarks: Number(maxMarks),
      });
      createdCount++;
      affectedStudents.add(`${entry.studentId}:${targetMonth}:${targetYear}`);
    }
  } else {
    if (!month || !year)
      return badRequest(res, "month and year required for monthly tests");
    const m = Number(month),
      y = Number(year);
    const now = new Date();
    if (
      y > now.getFullYear() ||
      (y === now.getFullYear() && m > now.getMonth() + 1)
    ) {
      return badRequest(res, "Test month cannot be in the future");
    }

    // Check batch lock once
    if (req.user.role === "TEACHER") {
      const approval = await BatchApproval.findOne({
        batchId, month: m, year: y,
      }).lean();
      if (approval) {
        return forbidden(res, "This month has been approved by admin and is locked");
      }
    }

    // Batch-fetch existing duplicates for all students in one query
    const studentIds = entries.filter(e => e.marks != null).map(e => e.studentId);
    const existingMonthly = await MonthlyTest.find({
      studentId: { $in: studentIds },
      subject,
      testType: testType || "Theory",
      month: m,
      year: y,
    }).select('studentId').lean();
    const duplicateSet = new Set(existingMonthly.map(t => String(t.studentId)));

    for (const entry of entries) {
      if (entry.marks == null) continue;
      if (!validStudentIds.has(entry.studentId)) { skippedCount++; continue; }
      if (duplicateSet.has(entry.studentId)) {
        skippedCount++;
        continue;
      }
      await testModel.createMonthly({
        studentId: entry.studentId,
        month: m,
        year: y,
        testType: testType || "Theory",
        subject,
        marks: Number(entry.marks),
        maxMarks: Number(maxMarks),
      });
      createdCount++;
      affectedStudents.add(`${entry.studentId}:${m}:${y}`);
    }
  }

  await Promise.all(
    [...affectedStudents].map((key) => {
      const [sid, m, y] = key.split(":");
      return syncCEForMonth(sid, Number(m), Number(y));
    }),
  );

  if (createdCount > 0) {
    const period = isWeekly ? weekDate : `${MONTHS[Number(month)]} ${year}`;
    logAudit(req, 'CREATE', isWeekly ? 'WeeklyTest' : 'MonthlyTest', batchId,
      `Bulk added ${createdCount} ${testType || 'Theory'} ${subject} tests for batch (${period})${skippedCount ? `, ${skippedCount} skipped` : ''}`);
  }

  return ok(
    res,
    { created: createdCount, skipped: skippedCount },
    `${createdCount} test(s) added${skippedCount ? `, ${skippedCount} skipped (duplicate)` : ""}`,
  );
}

async function updateWeekly(req, res) {
  const { testId } = req.params;
  const test = await testModel.findWeeklyById(testId);
  if (!test) return notFound(res, "Weekly test not found");

  const student = await studentModel.findById(test.studentId);
  if (!student || !student.isActive) return notFound(res, "Student not found");
  if (
    req.user.role === "TEACHER" &&
    !req.user.batchIds.includes(student.batchId)
  ) {
    return forbidden(res);
  }
  const d = new Date(test.weekDate);
  if (
    await isLocked(
      test.studentId,
      d.getMonth() + 1,
      d.getFullYear(),
      req.user.role,
    )
  ) {
    return forbidden(
      res,
      "This month has been approved by admin and is locked",
    );
  }

  const { marks, maxMarks, chapter } = req.body;
  const resolvedMarks    = marks    !== undefined ? Number(marks)    : test.marks;
  const resolvedMaxMarks = maxMarks !== undefined ? Number(maxMarks) : test.maxMarks;
  if (marks !== undefined && (!isFinite(resolvedMarks) || resolvedMarks < 0))
    return badRequest(res, "marks must be a non-negative number");
  if (maxMarks !== undefined && resolvedMaxMarks <= 0)
    return badRequest(res, "maxMarks must be positive");
  if (resolvedMarks > resolvedMaxMarks)
    return badRequest(res, "marks cannot exceed maxMarks");
  const updateData = {};
  if (marks !== undefined) updateData.marks = resolvedMarks;
  if (maxMarks !== undefined) updateData.maxMarks = resolvedMaxMarks;
  if (chapter !== undefined) updateData.chapter = chapter;

  const updated = await testModel.updateWeekly(testId, updateData);

  await syncCEForMonth(test.studentId, d.getMonth() + 1, d.getFullYear());
  logAudit(req, 'UPDATE', 'WeeklyTest', testId,
    `Updated ${test.testType} ${test.subject} — ${student.fullName} (${student.regNumber}) — ${updated.marks}/${updated.maxMarks} on ${test.weekDate.toISOString().split('T')[0]}`);

  return ok(res, updated);
}

async function deleteWeekly(req, res) {
  const { testId } = req.params;
  const test = await testModel.findWeeklyById(testId);
  if (!test) return notFound(res, "Weekly test not found");

  const student = await studentModel.findById(test.studentId);
  if (!student || !student.isActive) return notFound(res, "Student not found");
  if (
    req.user.role === "TEACHER" &&
    !req.user.batchIds.includes(student.batchId)
  ) {
    return forbidden(res);
  }
  const d = new Date(test.weekDate);
  if (
    await isLocked(
      test.studentId,
      d.getMonth() + 1,
      d.getFullYear(),
      req.user.role,
    )
  ) {
    return forbidden(
      res,
      "This month has been approved by admin and is locked",
    );
  }

  await testModel.deleteWeekly(testId);

  await syncCEForMonth(test.studentId, d.getMonth() + 1, d.getFullYear());
  logAudit(req, 'DELETE', 'WeeklyTest', testId,
    `Deleted ${test.testType} ${test.subject} — ${student.fullName} (${student.regNumber}) — ${test.marks}/${test.maxMarks} on ${d.toISOString().split('T')[0]}`);

  return ok(res, null, "Weekly test deleted");
}

async function updateMonthly(req, res) {
  const { testId } = req.params;
  const test = await testModel.findMonthlyById(testId);
  if (!test) return notFound(res, "Monthly test not found");

  const student = await studentModel.findById(test.studentId);
  if (!student || !student.isActive) return notFound(res, "Student not found");
  if (
    req.user.role === "TEACHER" &&
    !req.user.batchIds.includes(student.batchId)
  ) {
    return forbidden(res);
  }
  if (await isLocked(test.studentId, test.month, test.year, req.user.role)) {
    return forbidden(
      res,
      "This month has been approved by admin and is locked",
    );
  }

  const { marks, maxMarks } = req.body;
  const resolvedMarks    = marks    !== undefined ? Number(marks)    : test.marks;
  const resolvedMaxMarks = maxMarks !== undefined ? Number(maxMarks) : test.maxMarks;
  if (marks !== undefined && (!isFinite(resolvedMarks) || resolvedMarks < 0))
    return badRequest(res, "marks must be a non-negative number");
  if (maxMarks !== undefined && resolvedMaxMarks <= 0)
    return badRequest(res, "maxMarks must be positive");
  if (resolvedMarks > resolvedMaxMarks)
    return badRequest(res, "marks cannot exceed maxMarks");
  const updateData = {};
  if (marks !== undefined) updateData.marks = resolvedMarks;
  if (maxMarks !== undefined) updateData.maxMarks = resolvedMaxMarks;

  const updated = await testModel.updateMonthly(testId, updateData);

  await syncCEForMonth(test.studentId, test.month, test.year);
  logAudit(req, 'UPDATE', 'MonthlyTest', testId,
    `Updated ${test.testType} ${test.subject} — ${student.fullName} (${student.regNumber}) — ${updated.marks}/${updated.maxMarks} (${MONTHS[test.month]} ${test.year})`);

  return ok(res, updated);
}

async function deleteMonthly(req, res) {
  const { testId } = req.params;
  const test = await testModel.findMonthlyById(testId);
  if (!test) return notFound(res, "Monthly test not found");

  const student = await studentModel.findById(test.studentId);
  if (!student || !student.isActive) return notFound(res, "Student not found");
  if (
    req.user.role === "TEACHER" &&
    !req.user.batchIds.includes(student.batchId)
  ) {
    return forbidden(res);
  }
  if (await isLocked(test.studentId, test.month, test.year, req.user.role)) {
    return forbidden(
      res,
      "This month has been approved by admin and is locked",
    );
  }

  await testModel.deleteMonthly(testId);

  await syncCEForMonth(test.studentId, test.month, test.year);
  logAudit(req, 'DELETE', 'MonthlyTest', testId,
    `Deleted ${test.testType} ${test.subject} — ${student.fullName} (${student.regNumber}) — ${test.marks}/${test.maxMarks} (${MONTHS[test.month]} ${test.year})`);

  return ok(res, null, "Monthly test deleted");
}

module.exports = {
  listWeekly,
  addWeekly,
  updateWeekly,
  deleteWeekly,
  listMonthly,
  addMonthly,
  updateMonthly,
  deleteMonthly,
  bulkAdd,
};
