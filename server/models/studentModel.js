const prisma = require('../utils/prisma');

// All selects explicitly omit the password field.
const BASE_SELECT = {
  id: true,
  fullName: true,
  regNumber: true,
  batchId: true,
  isActive: true,
  photo: true,
  createdAt: true,
  updatedAt: true,
};

const findByBatch = (batchId) =>
  prisma.student.findMany({
    where: { batchId, isActive: true },
    select: {
      ...BASE_SELECT,
      batch: { select: { id: true, name: true } },
      ceRecords: {
        select: { totalCE: true, month: true, year: true },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      },
    },
    orderBy: { regNumber: 'asc' },
  });

const findById = (id) =>
  prisma.student.findUnique({
    where: { id },
    select: {
      ...BASE_SELECT,
      batch: { select: { id: true, name: true } },
    },
  });

const findByRegNumber = (regNumber) =>
  prisma.student.findFirst({
    where: { regNumber, isActive: true },
    // include password only for auth — caller must add select override
  });

const findAllActive = (batchIds) => {
  const where = { isActive: true };
  if (batchIds) where.batchId = { in: batchIds };
  return prisma.student.findMany({
    where,
    select: {
      ...BASE_SELECT,
      batch: { select: { id: true, name: true } },
    },
    orderBy: [{ batchId: 'asc' }, { regNumber: 'asc' }],
  });
};

const create = (data) =>
  prisma.student.create({
    data,
    select: BASE_SELECT,
  });

const update = (id, data) =>
  prisma.student.update({
    where: { id },
    data,
    select: BASE_SELECT,
  });

const softDelete = (id) =>
  prisma.student.update({
    where: { id },
    data: { isActive: false },
    select: { id: true },
  });

const findBatchReport = (batchId) =>
  prisma.student.findMany({
    where: { batchId, isActive: true },
    select: {
      ...BASE_SELECT,
      batch:        { select: { id: true, name: true } },
      weeklyTests:  { orderBy: { weekDate: 'asc' } },
      monthlyTests: { orderBy: [{ year: 'asc' }, { month: 'asc' }] },
      ceRecords:    { orderBy: [{ year: 'asc' }, { month: 'asc' }] },
    },
    orderBy: { regNumber: 'asc' },
  });

const search = (q, batchIds) => {
  const where = {
    isActive: true,
    OR: [
      { fullName: { contains: q, mode: 'insensitive' } },
      { regNumber: { contains: q, mode: 'insensitive' } },
    ],
  };
  if (batchIds && batchIds.length > 0) where.batchId = { in: batchIds };
  return prisma.student.findMany({
    where,
    select: {
      ...BASE_SELECT,
      batch: { select: { id: true, name: true } },
    },
    take: 10,
    orderBy: { regNumber: 'asc' },
  });
};

const findAllWithLatestCE = (batchIds) => {
  const where = { isActive: true };
  if (batchIds && batchIds.length > 0) where.batchId = { in: batchIds };
  return prisma.student.findMany({
    where,
    select: {
      ...BASE_SELECT,
      batch: { select: { id: true, name: true } },
      ceRecords: {
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 2,
        select: { totalCE: true, attendancePct: true, month: true, year: true },
      },
    },
    orderBy: [{ batchId: 'asc' }, { regNumber: 'asc' }],
  });
};

module.exports = { findByBatch, findById, findByRegNumber, findAllActive, create, update, softDelete, findBatchReport, search, findAllWithLatestCE };
