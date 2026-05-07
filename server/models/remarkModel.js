const prisma = require('../utils/prisma');

const findByStudent = (studentId) =>
  prisma.remark.findMany({
    where: { studentId },
    include: { teacher: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });

const findById = (id) => prisma.remark.findUnique({ where: { id } });

const create = (data) => prisma.remark.create({
  data,
  include: { teacher: { select: { id: true, name: true } } },
});

const update = (id, data) => prisma.remark.update({
  where: { id },
  data,
  include: { teacher: { select: { id: true, name: true } } },
});

module.exports = { findByStudent, findById, create, update };
