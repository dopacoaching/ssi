const prisma = require('../utils/prisma');

const findWeeklyByStudent = (studentId) =>
  prisma.weeklyTest.findMany({
    where: { studentId },
    orderBy: { weekDate: 'desc' },
  });

const findWeeklyByStudentAndMonth = (studentId, month, year) =>
  prisma.weeklyTest.findMany({
    where: {
      studentId,
      weekDate: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) },
    },
    orderBy: { weekDate: 'desc' },
  });

const createWeekly = (data) => prisma.weeklyTest.create({ data });

const findWeeklyById = (id) => prisma.weeklyTest.findUnique({ where: { id } });

const updateWeekly = (id, data) => prisma.weeklyTest.update({ where: { id }, data });

const deleteWeekly = (id) => prisma.weeklyTest.delete({ where: { id } });

const findWeeklyDuplicate = (studentId, subject, testType, weekDate) =>
  prisma.weeklyTest.findFirst({ where: { studentId, subject, testType, weekDate: new Date(weekDate) } });

const findMonthlyByStudent = (studentId) =>
  prisma.monthlyTest.findMany({
    where: { studentId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

const findMonthlyByStudentAndMonth = (studentId, month, year) =>
  prisma.monthlyTest.findMany({
    where: { studentId, month, year },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

const createMonthly = (data) => prisma.monthlyTest.create({ data });

const findMonthlyById = (id) => prisma.monthlyTest.findUnique({ where: { id } });

const updateMonthly = (id, data) => prisma.monthlyTest.update({ where: { id }, data });

const deleteMonthly = (id) => prisma.monthlyTest.delete({ where: { id } });

const findMonthlyDuplicate = (studentId, subject, testType, month, year) =>
  prisma.monthlyTest.findFirst({ where: { studentId, subject, testType, month, year } });

module.exports = {
  findWeeklyByStudent, findWeeklyByStudentAndMonth, createWeekly, findWeeklyDuplicate, findWeeklyById, updateWeekly, deleteWeekly,
  findMonthlyByStudent, findMonthlyByStudentAndMonth, createMonthly, findMonthlyDuplicate, findMonthlyById, updateMonthly, deleteMonthly,
};
