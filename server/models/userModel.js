const { User, normalize } = require('./schemas');
const { orNotFound } = require('../utils/errors');

const findByEmail = (email) =>
  User.findOne({ email }).lean().then(normalize);

const findById = (id) =>
  User.findById(id).lean().then(normalize);

const create = (data) =>
  User.create(data).then((doc) => normalize(doc.toObject()));

const findAll = () =>
  User.find()
    .select('email name role batchIds isActive createdAt')
    .lean()
    .then(normalize);

const update = (id, data) =>
  User.findByIdAndUpdate(id, data, { new: true }).lean().then(normalize).then(orNotFound('User'));

module.exports = { findByEmail, findById, create, findAll, update };
