const { CERecord, normalize } = require('./schemas');
const { orNotFound } = require('../utils/errors');

const findByStudent = (studentId) =>
  CERecord.find({ studentId }).sort({ year: -1, month: -1 }).lean().then(normalize);

const findOne = (studentId, month, year) =>
  CERecord.findOne({ studentId, month, year }).lean().then(normalize);

const create = (data) =>
  CERecord.create(data).then((doc) => normalize(doc.toObject()));

const update = (id, data) =>
  CERecord.findByIdAndUpdate(id, data, { new: true }).lean().then(normalize).then(orNotFound('CE record'));

const findById = (id) =>
  CERecord.findById(id).lean().then(normalize);

const remove = (id) =>
  CERecord.findByIdAndDelete(id).lean().then(normalize).then(orNotFound('CE record'));

module.exports = { findByStudent, findOne, create, update, findById, remove };
