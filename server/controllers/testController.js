const testModel = require("../models/testModel");
const studentModel = require("../models/studentModel");
const ceModel = require("../models/ceModel");
const prisma = require("../utils/prisma");
const { computeCE } = require("../utils/ceScoring");
const {
  ok,
  created,
  badRequest,
  forbidden,
  notFound,
} = require("../views/response");

async function isLocked(studentId, month, year, userRole) {
  if (userRole !== "TEACHER") return false;
  const student = await studentModel.findById(studentId);
  if (!student) return false;
  const approval = await prisma.batchApproval.findFirst({
    where: { batchId: student.batchId, month, year }
  });
  return !!approval;
}

async function syncCEForMonth(studentId, month, year) {
  const weekly = await testModel.findWeeklyByStudent(studentId);
  const monthly = await testModel.findMonthlyByStudent(studentId);

  const weeklyInMonth = weekly.filter((t) => {
    const d = new Date(t.weekDate);
    return d.getMonth() + 1 === month && d.getFullYear() === year;
  });
  const monthlyInMonth = monthly.filter(
    (t) => t.month === month && t.year === year,
  );

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
    mcqMarks,
    mcqMax,
    mcqPct: mcqMax > 0 ? (mcqMarks / mcqMax) * 100 : 0,
    attendancePct: existing ? existing.attendancePct : 0,
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

async function addWeekly(req, res) {
  if (!(await guardStudent(req, res))) return;
  const { weekDate, testType, subject, chapter, marks, maxMarks } = req.body;
  if (!weekDate || !subject || marks == null || !maxMarks)
    return badRequest(res, "Missing fields");
  if (Number(maxMarks) <= 0)
    return badRequest(res, "maxMarks must be positive");
  const d = new Date(weekDate);
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

  return created(res, test);
}

async function listMonthly(req, res) {
  if (!(await guardStudent(req, res))) return;
  const tests = await testModel.findMonthlyByStudent(req.params.id);
  return ok(res, tests);
}

async function addMonthly(req, res) {
  if (!(await guardStudent(req, res))) return;
  const { month, year, testType, subject, marks, maxMarks } = req.body;
  if (!month || !year || !subject || marks == null || !maxMarks)
    return badRequest(res, "Missing fields");
  if (Number(maxMarks) <= 0)
    return badRequest(res, "maxMarks must be positive");
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
  if (Number(maxMarks) <= 0)
    return badRequest(res, "maxMarks must be positive");

  let createdCount = 0,
    skippedCount = 0;
  const affectedStudents = new Set();

  if (isWeekly) {
    if (!weekDate) return badRequest(res, "weekDate required for weekly tests");
    const d = new Date(weekDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (d > today) return badRequest(res, "Test date cannot be in the future");
    const targetMonth = d.getMonth() + 1,
      targetYear = d.getFullYear();

    // Check batch lock once (all entries share the same batchId)
    if (req.user.role === "TEACHER") {
      const approval = await prisma.batchApproval.findFirst({
        where: { batchId, month: targetMonth, year: targetYear },
      });
      if (approval) {
        return forbidden(res, "This month has been approved by admin and is locked");
      }
    }

    // Batch-fetch existing duplicates for all students in one query
    const studentIds = entries.filter(e => e.marks != null).map(e => e.studentId);
    const existingWeekly = await prisma.weeklyTest.findMany({
      where: {
        studentId: { in: studentIds },
        subject,
        testType: testType || "Theory",
        weekDate: d,
      },
      select: { studentId: true },
    });
    const duplicateSet = new Set(existingWeekly.map(t => t.studentId));

    for (const entry of entries) {
      if (entry.marks == null) continue;
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
      const approval = await prisma.batchApproval.findFirst({
        where: { batchId, month: m, year: y },
      });
      if (approval) {
        return forbidden(res, "This month has been approved by admin and is locked");
      }
    }

    // Batch-fetch existing duplicates for all students in one query
    const studentIds = entries.filter(e => e.marks != null).map(e => e.studentId);
    const existingMonthly = await prisma.monthlyTest.findMany({
      where: {
        studentId: { in: studentIds },
        subject,
        testType: testType || "Theory",
        month: m,
        year: y,
      },
      select: { studentId: true },
    });
    const duplicateSet = new Set(existingMonthly.map(t => t.studentId));

    for (const entry of entries) {
      if (entry.marks == null) continue;
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
  const updateData = {};
  if (marks !== undefined) updateData.marks = Number(marks);
  if (maxMarks !== undefined) updateData.maxMarks = Number(maxMarks);
  if (chapter !== undefined) updateData.chapter = chapter;

  const updated = await testModel.updateWeekly(testId, updateData);

  await syncCEForMonth(test.studentId, d.getMonth() + 1, d.getFullYear());

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
  const updateData = {};
  if (marks !== undefined) updateData.marks = Number(marks);
  if (maxMarks !== undefined) updateData.maxMarks = Number(maxMarks);

  const updated = await testModel.updateMonthly(testId, updateData);

  await syncCEForMonth(test.studentId, test.month, test.year);

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
