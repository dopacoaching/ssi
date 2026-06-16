const prisma = require('../utils/prisma');

const findByEmail = (email) => prisma.user.findUnique({ where: { email } });

const findById = (id) => prisma.user.findUnique({ where: { id } });

const create = (data) => prisma.user.create({ data });

const findAll = () =>
  prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, batchIds: true, isActive: true, createdAt: true },
  });

const update = (id, data) => prisma.user.update({ where: { id }, data });

module.exports = { findByEmail, findById, create, findAll, update };
