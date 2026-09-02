const { Batch, Student, normalize } = require('./schemas');

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

const findAll = async () => {
  const batches = await Batch.find({ isActive: true }).sort({ name: 1 }).lean();
  const countFor = await activeCounts(batches.map((b) => b._id));
  return batches.map((b) => ({ ...normalize(b), _count: countFor(b._id) }));
};

const findById = async (id) => {
  const batch = await Batch.findById(id).lean();
  if (!batch) return null;
  const countFor = await activeCounts([batch._id]);
  return { ...normalize(batch), _count: countFor(batch._id) };
};

const create = (data) =>
  Batch.create(data).then((doc) => normalize(doc.toObject()));

const update = (id, data) =>
  Batch.findByIdAndUpdate(id, data, { new: true }).lean().then(normalize);

module.exports = { findAll, findById, create, update };
