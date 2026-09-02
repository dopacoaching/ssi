const { Remark, normalize } = require('./schemas');
const { orNotFound } = require('../utils/errors');

// Prisma returned the related teacher under `remark.teacher` as { id, name }.
// Mongoose `populate` would overwrite `teacherId` itself, so we populate a copy
// and reshape it back into that same `{ teacher: { id, name } }` form.
function shape(row) {
  if (!row) return row;
  const teacher = row.teacherId && typeof row.teacherId === 'object'
    ? { id: String(row.teacherId._id), name: row.teacherId.name }
    : null;
  const flat = { ...row, teacherId: teacher ? teacher.id : row.teacherId };
  return { ...normalize(flat), teacher };
}

const findByStudent = (studentId) =>
  Remark.find({ studentId })
    .sort({ createdAt: -1 })
    .populate({ path: 'teacherId', select: 'name' })
    .lean()
    .then((rows) => rows.map(shape));

const findById = (id) =>
  Remark.findById(id).lean().then(normalize);

const create = (data) =>
  Remark.create(data)
    .then((doc) => doc.populate({ path: 'teacherId', select: 'name' }))
    .then((doc) => shape(doc.toObject()));

const update = (id, data) =>
  Remark.findByIdAndUpdate(id, data, { new: true })
    .populate({ path: 'teacherId', select: 'name' })
    .lean()
    .then(shape)
    .then(orNotFound('Remark'));

module.exports = { findByStudent, findById, create, update };
