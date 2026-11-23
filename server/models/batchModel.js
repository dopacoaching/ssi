const { Batch, Student, normalize } = require('./schemas');
const { orNotFound } = require('../utils/errors');
const campusModel = require('./campusModel');

// Active-student counts keyed by batch id, for the `_count.students` shape the
// Prisma layer returned.
async function activeCounts(batchIds) {
  const rows = await Student.aggregate([
    { $match: { batchId: { $in: batchIds }, isActive: true } },
    { $group: { _id: '$batchId', n: { $sum: 1 } } },
  ]);
  const map = new Map(rows.map((r) => [String(r._id), r.n]));
  return (id) => ({ students: map.get(String(id)) || 0 });
}

// Adds `campusId` (string|null) and `campus` ({id,name,code}|null) to normalised batches.
async function withCampus(batches) {
  const campuses = await campusModel.summariesByIds(batches.map((b) => b.campusId));
  return batches.map((b) => ({
    ...b,
    campusId: b.campusId || null,
    campus: (b.campusId && campuses.get(String(b.campusId))) || null,
  }));
}

const findAll = async () => {
  const batches = await Batch.find({ isActive: true }).sort({ name: 1 }).lean();
  const countFor = await activeCounts(batches.map((b) => b._id));
  const shaped = batches.map((b) => ({ ...normalize(b), _count: countFor(b._id) }));
  return withCampus(shaped);
};

const findById = async (id) => {
  const batch = await Batch.findById(id).lean();
  if (!batch) return null;
  const countFor = await activeCounts([batch._id]);
  const [shaped] = await withCampus([{ ...normalize(batch), _count: countFor(batch._id) }]);
  return shaped;
};

const create = async (data) => {
  const doc = await Batch.create(data);
  const [shaped] = await withCampus([normalize(doc.toObject())]);
  return shaped;
};

const update = async (id, data) => {
  const updated = await Batch.findByIdAndUpdate(id, data, { new: true }).lean().then(normalize).then(orNotFound('Batch'));
  const [shaped] = await withCampus([updated]);
  return shaped;
};

module.exports = { findAll, findById, create, update };
