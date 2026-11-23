const { Charge, BookCopy, Book, User, normalize } = require('./schemas');
const { round2 } = require('../services/fineService');

const OPEN_STATUSES = ['UNPAID', 'PARTIAL'];

// Outstanding part of one charge (never negative).
const balanceOf = (c) => Math.max(0, round2((c.amount || 0) - (c.paidAmount || 0) - (c.waivedAmount || 0)));

// ---------------------------------------------------------------------------
// Atomic balance / status maths (payments, voids, waivers, bulk waivers all share this).
// Money is stored as rupee doubles with 2 decimals; every stored value is round2'd and every
// comparison against a requested amount uses a half-paisa tolerance, so float drift
// (0.1 + 0.2) can never make a legitimate request fail or let an over-payment through.
// ---------------------------------------------------------------------------

const MONEY_TOLERANCE = 0.005;

// Pure mirror of the status expression below (used by tests and for sanity checks).
const statusFor = ({ amount, paidAmount = 0, waivedAmount = 0 }) => {
  const balance = round2((amount || 0) - (paidAmount || 0) - (waivedAmount || 0));
  const settled = round2((paidAmount || 0) + (waivedAmount || 0));
  if (balance > 0 && settled <= 0) return 'UNPAID';
  if (balance > 0) return 'PARTIAL';
  if ((paidAmount || 0) > 0) return 'PAID';
  return 'WAIVED';
};

// Mongo expression: round2(amount - paidAmount - waivedAmount) on the CURRENT document.
const BALANCE_EXPR = { $round: [{ $subtract: ['$amount', { $add: ['$paidAmount', '$waivedAmount'] }] }, 2] };

// Query filter: the charge still has at least `x` rupees of balance.
const balanceAtLeast = (x) => ({ $expr: { $gte: [BALANCE_EXPR, round2(x) - MONEY_TOLERANCE] } });

// Query filter: the charge has at least `x` rupees paid (used when reversing a payment).
const paidAtLeast = (x) => ({ $expr: { $gte: ['$paidAmount', round2(x) - MONEY_TOLERANCE] } });

// Aggregation-pipeline update: paidAmount += paid, waivedAmount += waived (either may be
// negative; results never go below 0 and are round2'd), then the status is re-derived from the
// NEW values - all in one atomic single-document update.
const balanceUpdatePipeline = ({ paid = 0, waived = 0 } = {}) => {
  const bump = (field, delta) => ({ $max: [0, { $round: [{ $add: [`$${field}`, round2(delta)] }, 2] }] });
  const newBalance = { $round: [{ $subtract: ['$amount', { $add: ['$paidAmount', '$waivedAmount'] }] }, 2] };
  return [
    { $set: { paidAmount: bump('paidAmount', paid), waivedAmount: bump('waivedAmount', waived), updatedAt: '$$NOW' } },
    { $set: { status: {
      $switch: {
        branches: [
          { case: { $and: [{ $gt: [newBalance, 0] }, { $lte: [{ $round: [{ $add: ['$paidAmount', '$waivedAmount'] }, 2] }, 0] }] }, then: 'UNPAID' },
          { case: { $gt: [newBalance, 0] }, then: 'PARTIAL' },
          { case: { $gt: ['$paidAmount', 0] }, then: 'PAID' },
        ],
        default: 'WAIVED',
      },
    } } },
  ];
};

// The ONE conditional update. `filter` carries identity (_id / campusId / studentId); the
// balance guard is added here. kind: 'pay' | 'waive' (consume balance) or 'unpay' (reverse paid).
// Returns the updated lean doc, or null when the guard (or identity) did not match.
const applyDelta = (filter, { kind, amount }, { session } = {}) => {
  const a = round2(amount);
  let guard;
  let delta;
  if (kind === 'pay') { guard = balanceAtLeast(a); delta = { paid: a }; }
  else if (kind === 'waive') { guard = balanceAtLeast(a); delta = { waived: a }; }
  else if (kind === 'unpay') { guard = {}; delta = { paid: -a }; }
  else throw new Error(`applyDelta: unknown kind ${kind}`);
  return Charge.findOneAndUpdate({ ...filter, ...guard }, balanceUpdatePipeline(delta), { new: true, session }).lean();
};

// bulkWrite op for the same update (identity filter must include _id).
const waiveOp = (filter, amount) => ({
  updateOne: { filter: { ...filter, ...balanceAtLeast(amount) }, update: balanceUpdatePipeline({ waived: amount }) },
});

const findById = (id, { session } = {}) => Charge.findById(id).session(session || null).lean();

// Unpaid / partially paid charges of a student across ALL campuses (raw lean docs).
const findUnpaidByStudent = (studentId, { session } = {}) =>
  Charge.find({ studentId, status: { $in: OPEN_STATUSES } }).session(session || null).lean();

const hasUnpaidAtCampus = (studentId, campusId) =>
  Charge.exists({ studentId, campusId, status: { $in: OPEN_STATUSES } }).then(Boolean);

const hasAnyAtCampus = (studentId, campusId) => Charge.exists({ studentId, campusId }).then(Boolean);

const findByStudent = (studentId, scope = {}, limit = 500) =>
  Charge.find({ studentId, ...scope }).sort({ createdAt: -1 }).limit(limit).lean();

// Plain insert docs -> created lean docs (transaction-aware, ordered).
const insertMany = async (docs, { session } = {}) => {
  if (docs.length === 0) return [];
  const created = await Charge.create(docs, { session, ordered: true });
  return created.map((d) => d.toObject());
};

// ChargeView[] with copy / book / createdBy stitched in batched queries.
const shapeMany = async (docs) => {
  if (docs.length === 0) return [];
  const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];
  const copies = await BookCopy.find({ _id: { $in: uniq(docs.map((d) => d.copyId)) } }).select('catalogNumber bookId').lean();
  const [books, users] = await Promise.all([
    Book.find({ _id: { $in: uniq(copies.map((c) => c.bookId)) } }).select('title').lean(),
    User.find({ _id: { $in: uniq(docs.map((d) => d.createdBy)) } }).select('name').lean(),
  ]);
  const copyById = new Map(copies.map((c) => [String(c._id), c]));
  const bookById = new Map(books.map((b) => [String(b._id), b]));
  const userById = new Map(users.map((u) => [String(u._id), u.name]));
  return docs.map((d) => {
    const n = normalize(d);
    const copy = copyById.get(String(d.copyId));
    const book = copy ? bookById.get(String(copy.bookId)) : null;
    const by = d.createdBy ? String(d.createdBy) : null;
    return {
      id: n.id, campusId: n.campusId, type: n.type, amount: n.amount,
      paidAmount: n.paidAmount || 0, waivedAmount: n.waivedAmount || 0, balance: balanceOf(d),
      status: n.status, note: n.note || '', loanId: n.loanId,
      copy: { id: n.copyId, catalogNumber: copy?.catalogNumber || '' },
      book: { id: copy ? String(copy.bookId) : '', title: book?.title || '' },
      createdAt: n.createdAt,
      createdBy: { id: by, name: (by && userById.get(by)) || 'Unknown' },
    };
  });
};

module.exports = {
  MONEY_TOLERANCE, BALANCE_EXPR, statusFor, balanceAtLeast, paidAtLeast, balanceUpdatePipeline, applyDelta, waiveOp, findById,
  balanceOf, findUnpaidByStudent, hasUnpaidAtCampus, hasAnyAtCampus, findByStudent, insertMany, shapeMany,
};
