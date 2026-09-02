const { CERecord, normalize } = require('./schemas');

const findByStudent = (studentId) =>
  CERecord.find({ studentId }).sort({ year: -1, month: -1 }).lean().then(normalize);

const findOne = (studentId, month, year) =>
  CERecord.findOne({ studentId, month, year }).lean().then(normalize);

const create = (data) =>
  CERecord.create(data).then((doc) => normalize(doc.toObject()));

const update = (id, data) =>
  CERecord.findByIdAndUpdate(id, data, { new: true }).lean().then(normalize);

const findById = (id) =>
  CERecord.findById(id).lean().then(normalize);

const remove = (id) =>
  CERecord.findByIdAndDelete(id).lean().then(normalize);

module.exports = { findByStudent, findOne, create, update, findById, remove };
