const { mongoose } = require('../utils/db');
const { BookCopy, User, normalize } = require('./schemas');
const loanModel = require('./loanModel');

const shape = (c, namesById = new Map()) => {
  const n = normalize(c);
  const wb = n.withdrawnBy ? String(n.withdrawnBy) : null;
  return {
    ...n,
    shelfLocation: n.shelfLocation || '',
    remarks: n.remarks || '',
    withdrawReason: n.withdrawReason || '',
    statusBeforeWithdraw: n.statusBeforeWithdraw || null,
    withdrawnAt: n.withdrawnAt || null,
    withdrawnBy: wb ? { id: wb, name: namesById.get(wb) || 'Unknown' } : null,
  };
};

// Batched name lookup for withdrawnBy (one query for the whole set).
const withdrawerNames = async (docs) => {
  const ids = [...new Set(docs.map((d) => d.withdrawnBy).filter(Boolean).map(String))];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select('name').lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
};

const shapeMany = async (docs) => {
  const names = await withdrawerNames(docs);
  return docs.map((d) => shape(d, names));
};

const findById = (id) => BookCopy.findById(id).lean();           // raw lean doc (scope checks)

const findShapedById = async (id) => {
  const doc = await BookCopy.findById(id).lean();
  return doc ? (await shapeMany([doc]))[0] : null;
};

// All copies for many books in ONE query, sorted by seq. Returns Map<bookId, BookCopy[]>.
const findByBookIds = async (bookIds) => {
  const map = new Map();
  if (!bookIds || bookIds.length === 0) return map;
  const docs = await BookCopy.find({ bookId: { $in: bookIds } }).sort({ seq: 1 }).lean();
  const shaped = await shapeMany(docs);
  await loanModel.attachLoanInfo(shaped);   // `loan` on ISSUED copies (batched)
  for (const c of shaped) {
    if (!map.has(c.bookId)) map.set(c.bookId, []);
    map.get(c.bookId).push(c);
  }
  return map;
};

const emptyCounts = () => ({ total: 0, AVAILABLE: 0, ISSUED: 0, LOST: 0, DAMAGED: 0, WITHDRAWN: 0 });

const countsFor = (copies) => {
  const counts = emptyCounts();
  for (const c of copies) {
    counts.total += 1;
    if (counts[c.status] !== undefined) counts[c.status] += 1;
  }
  return counts;
};

// Distinct bookIds having at least one copy matching `filter` (already campus-scoped).
const distinctBookIds = (filter) => BookCopy.distinct('bookId', filter);

const updateFields = (id, data) =>
  BookCopy.findByIdAndUpdate(id, { $set: data }, { new: true }).lean();

// Atomic: only an AVAILABLE or DAMAGED copy can be withdrawn. Returns { doc, previous } or null
// if the guard failed. The pre-update doc supplies the status that gets remembered.
const withdraw = async (id, { userId, reason }) => {
  const before = await BookCopy.findOneAndUpdate(
    { _id: id, status: { $in: ['AVAILABLE', 'DAMAGED'] } },
    [{ $set: {
      statusBeforeWithdraw: '$status', status: 'WITHDRAWN', withdrawnAt: '$$NOW',
      withdrawnBy: userId ? new mongoose.Types.ObjectId(String(userId)) : null,
      withdrawReason: { $literal: reason }, updatedAt: '$$NOW',
    } }],
    { new: false },
  ).lean();
  return before ? { previous: before.status } : null;
};

// Atomic: only a WITHDRAWN copy can be reinstated; restores the pre-withdraw status
// (DAMAGED stays DAMAGED; unknown → AVAILABLE). Returns { previous } (restored status) or null.
const reinstate = async (id) => {
  const before = await BookCopy.findOneAndUpdate(
    { _id: id, status: 'WITHDRAWN' },
    [{ $set: {
      status: { $ifNull: ['$statusBeforeWithdraw', 'AVAILABLE'] },
      statusBeforeWithdraw: null, withdrawnAt: null, withdrawnBy: null, withdrawReason: '', updatedAt: '$$NOW',
    } }],
    { new: false },
  ).lean();
  return before ? { restored: before.statusBeforeWithdraw || 'AVAILABLE' } : null;
};

module.exports = {
  shape, shapeMany, findById, findShapedById, findByBookIds, countsFor, emptyCounts,
  distinctBookIds, updateFields, withdraw, reinstate,
};
