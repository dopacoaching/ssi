const prisma = require('../utils/prisma');

const findAll = () =>
  prisma.batch.findMany({
    where: { isActive: true },
    include: { _count: { select: { students: { where: { isActive: true } } } } },
    orderBy: { name: 'asc' },
  });

const findById = (id) =>
  prisma.batch.findUnique({
    where: { id },
    include: { _count: { select: { students: { where: { isActive: true } } } } },
  });

const create = (data) => prisma.batch.create({ data });

const update = (id, data) => prisma.batch.update({ where: { id }, data });

const deactivate = (id) => prisma.batch.update({ where: { id }, data: { isActive: false } });

module.exports = { findAll, findById, create, update, deactivate };
