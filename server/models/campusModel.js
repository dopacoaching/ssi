const { Campus, Batch, User, normalize } = require('./schemas');
const { orNotFound } = require('../utils/errors');
const { listKey } = require('../utils/catalogValidation');
const { MAX_LIST_ENTRIES } = require('../utils/validation');


// Normalised campus doc with array defaults guaranteed (older rows / lean docs).
const shape = (c) => {
  const n = normalize(c);
  return { ...n, shelfLocations: n.shelfLocations || [], categories: n.categories || [] };
};

// Active batches per campus id, stitched in memory (same style as batchModel).
async function attachBatches(campuses) {
  if (campuses.length === 0) return campuses;
  const rows = await Batch.find({ campusId: { $in: campuses.map((c) => c.id) }, isActive: true })
    .select('name year campusId').sort({ name: 1 }).lean();
  const map = new Map();
  for (const b of rows) {
    const k = String(b.campusId);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ id: String(b._id), name: b.name, year: b.year });
  }
  return campuses.map((c) => ({ ...c, batches: map.get(c.id) || [] }));
}

const findAll = async ({ includeInactive = false, withBatches = false } = {}) => {
  const filter = includeInactive ? {} : { isActive: true };
  const docs = await Campus.find(filter).sort({ name: 1 }).lean();
  const campuses = docs.map(shape);
  return withBatches ? attachBatches(campuses) : campuses;
};

const findById = (id) =>
  Campus.findById(id).lean().then((c) => (c ? shape(c) : null));

const findByIds = async (ids) => {
  if (!ids || ids.length === 0) return [];
  const docs = await Campus.find({ _id: { $in: ids } }).lean();
  return docs.map(shape);
};

// Case-insensitive exact match on name and/or code, for duplicate pre-checks.
// `excludeId` skips the campus being edited.
const findByNameOrCode = async ({ name, code, excludeId } = {}) => {
  const or = [];
  const exact = (v) => ({ $regex: `^${String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' });
  if (name) or.push({ name: exact(name) });
  if (code) or.push({ code: exact(code) });
  if (or.length === 0) return [];
  const filter = { $or: or };
  if (excludeId) filter._id = { $ne: excludeId };
  const docs = await Campus.find(filter).lean();
  return docs.map(shape);
};

const create = (data) =>
  Campus.create(data).then((doc) => shape(doc.toObject()));

const update = (id, data) =>
  Campus.findByIdAndUpdate(id, { $set: data }, { new: true }).lean()
    .then((c) => (c ? shape(c) : null)).then(orNotFound('Campus'));

// Add categories / shelves that the campus doesn't have yet (case-insensitive, same
// normalisation as cleanStringList; existing spelling wins). Only the missing values are
// $pushed, so concurrent edits to the lists are never overwritten. Accepts a session.
// Returns { addedCategories, addedShelves }.
const addToLists = async (id, { categories = [], shelfLocations = [] } = {}, { session } = {}) => {
  const cats = categories.filter((v) => typeof v === 'string' && v.trim());
  const shelves = shelfLocations.filter((v) => typeof v === 'string' && v.trim());
  if (cats.length === 0 && shelves.length === 0) return { addedCategories: [], addedShelves: [] };

  const campus = await Campus.findById(id).select('categories shelfLocations').session(session || null).lean();
  if (!campus) return { addedCategories: [], addedShelves: [] };

  const missing = (incoming, current, cap, label) => {
    const seen = new Set((current || []).map(listKey));
    const out = [];
    for (const raw of incoming) {
      const v = raw.trim();
      const k = listKey(v);
      if (seen.has(k)) continue;
      if ((current || []).length + out.length >= cap) {
        const err = new Error(`${label} list for this campus is full (${cap}). Remove unused entries in Library Settings first.`);
        err.status = 400;
        throw err; // aborts the surrounding transaction
      }
      seen.add(k);
      out.push(v);
    }
    return out;
  };
  const addedCategories = missing(cats, campus.categories, MAX_LIST_ENTRIES, 'Category');
  const addedShelves = missing(shelves, campus.shelfLocations, MAX_LIST_ENTRIES, 'Shelf');

  const push = {};
  if (addedCategories.length) push.categories = { $each: addedCategories };
  if (addedShelves.length) push.shelfLocations = { $each: addedShelves };
  if (Object.keys(push).length) await Campus.updateOne({ _id: id }, { $push: push }, { session });
  return { addedCategories, addedShelves };
};

const countActiveBatches = (id) => Batch.countDocuments({ campusId: id, isActive: true });

const countActiveStaff = (id) => User.countDocuments({ libraryCampusId: id, isActive: true });

// Map<campusId, {id,name,code}> for stitching onto batches / staff.
const summariesByIds = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const docs = await Campus.find({ _id: { $in: unique } }).select('name code').lean();
  return new Map(docs.map((c) => [String(c._id), { id: String(c._id), name: c.name, code: c.code }]));
};

module.exports = {
  findAll, findById, findByIds, findByNameOrCode, create, update, addToLists,
  countActiveBatches, countActiveStaff, summariesByIds,
};
