const prisma = require('../utils/prisma');

const findByStudent = (studentId) =>
  prisma.cERecord.findMany({
    where: { studentId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

const findOne = (studentId, month, year) =>
  prisma.cERecord.findFirst({ where: { studentId, month, year } });

const create = (data) => prisma.cERecord.create({ data });

const update = (id, data) => prisma.cERecord.update({ where: { id }, data });

const findById = (id) => prisma.cERecord.findUnique({ where: { id } });

const remove = (id) => prisma.cERecord.delete({ where: { id } });

module.exports = { findByStudent, findOne, create, update, findById, remove };
