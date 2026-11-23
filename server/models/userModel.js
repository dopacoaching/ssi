const { User, normalize } = require('./schemas');
const { orNotFound } = require('../utils/errors');
const campusModel = require('./campusModel');

const STAFF_ROLES = ['TEACHER', 'LIBRARIAN'];

const findByEmail = (email) =>
  User.findOne({ email }).lean().then(normalize);

const findById = (id) =>
  User.findById(id).lean().then(normalize);

const create = (data) =>
  User.create(data).then((doc) => normalize(doc.toObject()));

const findAll = () =>
  User.find()
    .select('email name role batchIds isActive libraryCampusId createdAt')
    .lean()
    .then(normalize);

const update = (id, data) =>
  User.findByIdAndUpdate(id, data, { new: true }).lean().then(normalize).then(orNotFound('User'));

// Client-facing staff shape (no password), with the library campus stitched on.
async function toStaff(users) {
  const campuses = await campusModel.summariesByIds(users.map((u) => u.libraryCampusId));
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    batchIds: u.role === 'LIBRARIAN' ? [] : (u.batchIds || []),
    libraryCampusId: u.libraryCampusId || null,
    libraryCampus: (u.libraryCampusId && campuses.get(String(u.libraryCampusId))) || null,
    isActive: u.isActive,
    createdAt: u.createdAt,
  }));
}

const findAllStaff = async () => {
  const users = await User.find({ role: { $in: STAFF_ROLES } })
    .select('email name role batchIds isActive libraryCampusId createdAt')
    .sort({ name: 1 })
    .lean()
    .then(normalize);
  return toStaff(users);
};

module.exports = { findByEmail, findById, create, findAll, update, toStaff, findAllStaff, STAFF_ROLES };
