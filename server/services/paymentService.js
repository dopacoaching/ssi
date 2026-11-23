// Payments: receipt counter + charge settlement in ONE transaction, and void (reversal).
// No req/res here. Callbacks are retry-safe (state is reset at the top, no side effects
// outside the session); audit is the controller's job, after commit.
const { mongoose } = require('../utils/db');
const { Payment, LibraryCounter, BookCopy } = require('../models/schemas');
const chargeModel = require('../models/chargeModel');
const fine = require('./fineService');
const { CirculationError, withSession, money } = require('./circulationService');

const ObjectId = mongoose.Types.ObjectId;

// `${campus.code}-R-000012` (wider numbers just grow).
const formatReceipt = (code, n) => `${code}-R-${String(n).padStart(6, '0')}`;

// The counter doc is shared with the catalog counter (per campus). Make sure it exists BEFORE
// the transaction so two first-ever payments never race an upsert inside a transaction.
async function ensureCounter(campusId) {
  try {
    await LibraryCounter.updateOne({ campusId }, { $setOnInsert: { campusId, seq: 0, receiptSeq: 0 } }, { upsert: true });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
}

// Builds the 400 for a failed conditional charge update (reads inside the same session).
async function shortfall(alloc, { campusId, studentId }, session) {
  const charge = await chargeModel.findById(alloc.chargeId, { session });
  if (!charge || String(charge.campusId) !== String(campusId) || String(charge.studentId) !== String(studentId)) {
    return new CirculationError('A selected charge was not found for this student at this campus');
  }
  const copy = await BookCopy.findById(charge.copyId).select('catalogNumber').session(session).lean();
  return new CirculationError(`Charge ${copy?.catalogNumber || charge.type} has only ₹${money(chargeModel.balanceOf(charge))} left to pay`);
}

// allocations: [{ chargeId: string, amount }] (validated); total = sum of amounts.
// Returns the created raw payment doc. Throws CirculationError (400).
async function createPayment({ campus, studentId, allocations, total, note, userId, requestId }) {
  const campusId = new ObjectId(String(campus.id));
  const student = new ObjectId(String(studentId));
  await ensureCounter(campusId);
  let payment = null;
  let duplicate = false;
  // Idempotency: same (campus, requestId) -> the existing receipt; nothing is charged twice.
  const existingFor = async (session) => {
    const ex = await Payment.findOne({ campusId, requestId }).session(session || null).lean();
    if (!ex) return null;
    // A genuine retry carries the same student, total and allocations; anything else reusing the
    // id is a different payment and must not be answered with the old receipt.
    const sig = (list) => list.map((a) => `${String(a.chargeId)}:${fine.round2(a.amount)}`).sort().join('|');
    const same = String(ex.studentId) === String(student)
      && Math.abs(fine.round2(ex.amount) - fine.round2(total)) < chargeModel.MONEY_TOLERANCE
      && sig(ex.allocations || []) === sig(allocations);
    if (!same) throw new CirculationError('This request id was already used for a different payment — please refresh and try again');
    return ex;
  };
  const run = () => withSession((session) => session.withTransaction(async () => {
    payment = null;
    duplicate = false;
    const ex = await existingFor(session);
    if (ex) { payment = ex; duplicate = true; return; }
    // 1. settle every charge (conditional: same campus + student, balance >= amount)
    for (const a of allocations) {
      const updated = await chargeModel.applyDelta(
        { _id: new ObjectId(a.chargeId), campusId, studentId: student },
        { kind: 'pay', amount: a.amount }, { session },
      );
      if (!updated) throw await shortfall(a, { campusId, studentId: student }, session);
    }
    // 2. receipt number LAST (shortest hold on the hot counter doc); an aborted txn leaves no gap
    const counter = await LibraryCounter.findOneAndUpdate(
      { campusId }, { $inc: { receiptSeq: 1 } }, { new: true, upsert: true, session },
    ).lean();
    const seq = counter.receiptSeq;
    // 3. the immutable receipt
    const [doc] = await Payment.create([{
      campusId, studentId: student,
      receiptNumber: formatReceipt(campus.code, seq), receiptSeq: seq,
      amount: fine.round2(total),
      allocations: allocations.map((a) => ({ chargeId: new ObjectId(a.chargeId), amount: a.amount })),
      receivedBy: new ObjectId(String(userId)), receivedAt: new Date(), note: note || '', voided: null, requestId,
    }], { session });
    payment = doc.toObject();
  }));
  try {
    await run();
  } catch (err) {
    // Lost a race on the (campusId, requestId) unique index: return the winner's receipt.
    if (err?.code === 11000 && /requestId/.test(`${err.message || ''}${JSON.stringify(err.keyPattern || {})}`)) {
      const ex = await existingFor(null);
      if (ex) return { payment: ex, duplicate: true };
    }
    throw err;
  }
  return { payment, duplicate };
}

// Void: flips `voided` (only while still null) and reverses every allocation, atomically.
async function voidPayment({ paymentId, reason, userId }) {
  let result = null;
  await withSession((session) => session.withTransaction(async () => {
    result = null;
    const now = new Date();
    const voided = await Payment.findOneAndUpdate(
      { _id: paymentId, voided: null },
      { $set: { voided: { at: now, by: new ObjectId(String(userId)), reason } } },
      { new: true, session },
    ).lean();
    if (!voided) throw new CirculationError('This receipt is already voided');
    for (const a of voided.allocations) {
      const updated = await chargeModel.applyDelta({ _id: a.chargeId }, { kind: 'unpay', amount: a.amount }, { session });
      if (!updated) throw new CirculationError('A charge on this receipt no longer exists');
    }
    result = voided;
  }));
  return result;
}

module.exports = { formatReceipt, createPayment, voidPayment };
