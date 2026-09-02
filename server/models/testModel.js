const { WeeklyTest, MonthlyTest, normalize } = require('./schemas');
const { orNotFound } = require('../utils/errors');

// ── Weekly ──────────────────────────────────────────────────────────────────
const findWeeklyByStudent = (studentId) =>
  WeeklyTest.find({ studentId }).sort({ weekDate: -1 }).lean().then(normalize);

const findWeeklyByStudentAndMonth = (studentId, month, year) =>
  WeeklyTest.find({
    studentId,
    weekDate: { $gte: new Date(year, month - 1, 1), $lt: new Date(year, month, 1) },
  }).sort({ weekDate: -1 }).lean().then(normalize);

const createWeekly = (data) =>
  WeeklyTest.create(data).then((doc) => normalize(doc.toObject()));

const findWeeklyById = (id) =>
  WeeklyTest.findById(id).lean().then(normalize);

const updateWeekly = (id, data) =>
  WeeklyTest.findByIdAndUpdate(id, data, { new: true }).lean().then(normalize).then(orNotFound('Weekly test'));

const deleteWeekly = (id) =>
  WeeklyTest.findByIdAndDelete(id).lean().then(normalize).then(orNotFound('Weekly test'));

const findWeeklyDuplicate = (studentId, subject, testType, weekDate) =>
  WeeklyTest.findOne({ studentId, subject, testType, weekDate: new Date(weekDate) })
    .lean().then(normalize);

// ── Monthly ─────────────────────────────────────────────────────────────────
const findMonthlyByStudent = (studentId) =>
  MonthlyTest.find({ studentId }).sort({ year: -1, month: -1 }).lean().then(normalize);

const findMonthlyByStudentAndMonth = (studentId, month, year) =>
  MonthlyTest.find({ studentId, month, year }).sort({ year: -1, month: -1 }).lean().then(normalize);

const createMonthly = (data) =>
  MonthlyTest.create(data).then((doc) => normalize(doc.toObject()));

const findMonthlyById = (id) =>
  MonthlyTest.findById(id).lean().then(normalize);

const updateMonthly = (id, data) =>
  MonthlyTest.findByIdAndUpdate(id, data, { new: true }).lean().then(normalize).then(orNotFound('Monthly test'));

const deleteMonthly = (id) =>
  MonthlyTest.findByIdAndDelete(id).lean().then(normalize).then(orNotFound('Monthly test'));

const findMonthlyDuplicate = (studentId, subject, testType, month, year) =>
  MonthlyTest.findOne({ studentId, subject, testType, month, year }).lean().then(normalize);

module.exports = {
  findWeeklyByStudent, findWeeklyByStudentAndMonth, createWeekly, findWeeklyDuplicate,
  findWeeklyById, updateWeekly, deleteWeekly,
  findMonthlyByStudent, findMonthlyByStudentAndMonth, createMonthly, findMonthlyDuplicate,
  findMonthlyById, updateMonthly, deleteMonthly,
};
