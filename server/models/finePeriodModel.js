const { FinePeriod, Waiver, User, LibraryCounter, normalize } = require('./schemas');
const campusModel = require('./campusModel');

const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];

// Active (not cancelled) periods of the given campuses, ONE query.
// Returns Map<campusId, { from, to }[]> (campuses without periods are absent).
const loadActive = async (campusIds, { session } = {}) => {
  const ids = uniq(campusIds);
  const map = new Map();
  if (ids.length === 0) return map;
  const docs = await FinePeriod.find({ campusId: { $in: ids }, cancelled: null })
    .select('campusId from to').session(session || null).lean();
  for (const d of docs) {
    const k = String(d.campusId);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ from: d.from, to: d.to });
  }
  return map;
};

const activeForCampus = async (campusId, { session } = {}) =>
  (await loadActive([campusId], { session })).get(String(campusId)) || [];

// Per-campus "fine epoch" guard. returnLoan writes lastReturnAt, createPeriod / cancelPeriod write
// lastPeriodChangeAt, ALL on the same campus LibraryCounter doc inside their transactions, so two
// concurrent ones conflict (WriteConflict -> retry) instead of silently skewing.
const ensureCounter = async (campusId) => {
  try {
    await LibraryCounter.updateOne({ campusId }, { $setOnInsert: { campusId, seq: 0, receiptSeq: 0 } }, { upsert: true });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
};
const touchEpoch = (campusId, field, { session } = {}) =>
  LibraryCounter.updateOne({ campusId }, { $set: { [field]: new Date() } }, { session });

const findById = (id, { session } = {}) => FinePeriod.findById(id).session(session || null).lean();

// FinePeriodView[] (campus / users / waiver stats in batched queries).
const shapeMany = async (docs) => {
  if (docs.length === 0) return [];
  const [campuses, users, stats] = await Promise.all([
    campusModel.summariesByIds(docs.map((d) => d.campusId)),
    User.find({ _id: { $in: uniq(docs.flatMap((d) => [d.createdBy, d.cancelled?.by])) } }).select('name').lean(),
    Waiver.aggregate([
      { $match: { finePeriodId: { $in: docs.map((d) => d._id) }, status: 'APPROVED' } },
      { $group: { _id: '$finePeriodId', count: { $sum: 1 }, total: { $sum: '$approvedAmount' } } },
    ]),
  ]);
  const name = new Map(users.map((u) => [String(u._id), u.name]));
  const person = (id) => (id ? { id: String(id), name: name.get(String(id)) || 'Unknown' } : null);
  const stat = new Map(stats.map((s) => [String(s._id), s]));
  return docs.map((d) => {
    const n = normalize(d);
    const st = stat.get(String(d._id));
    return {
      id: n.id,
      campus: campuses.get(String(d.campusId)) || null,
      from: d.from, to: d.to, reason: d.reason || '',
      createdBy: person(d.createdBy),
      createdAt: n.createdAt,
      cancelled: d.cancelled ? { at: d.cancelled.at, by: person(d.cancelled.by), reason: d.cancelled.reason || '' } : null,
      waiverCount: st ? st.count : 0,
      totalWaived: st ? Math.round((st.total + Number.EPSILON) * 100) / 100 : 0,
    };
  });
};

const list = (scope = {}) => FinePeriod.find(scope).sort({ createdAt: -1, _id: -1 }).limit(500).lean();

module.exports = { ensureCounter, touchEpoch, loadActive, activeForCampus, findById, shapeMany, list };
