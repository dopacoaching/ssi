// Waivers: request (staff) / direct (admin) / approve / reject. Waived rupees are applied to
// Charge.waivedAmount through the shared conditional update in chargeModel. No req/res here.
const { mongoose } = require('../utils/db');
const { Waiver } = require('../models/schemas');
const chargeModel = require('../models/chargeModel');
const fine = require('./fineService');
const { CirculationError, withSession, money } = require('./circulationService');

const ObjectId = mongoose.Types.ObjectId;
const oid = (v) => new ObjectId(String(v));

const PENDING_EXISTS = 'This charge already has a pending waiver request';
const DECIDED = 'This request has already been decided';

// Staff REQUEST (PENDING) or admin DIRECT (applied immediately). `charge` is a lean doc the
// controller already scope-checked. Returns the raw waiver doc.
async function createWaiver({ charge, amount, reason, userId, isAdmin }) {
  const now = new Date();
  const base = {
    campusId: charge.campusId, studentId: charge.studentId, chargeId: charge._id,
    amount, reason, requestedBy: oid(userId), requestedAt: now, decisionNote: '', finePeriodId: null,
  };

  if (!isAdmin) {
    const balance = chargeModel.balanceOf(charge);
    if (balance <= 0) throw new CirculationError('Nothing left to waive on this charge');
    if (amount > balance + chargeModel.MONEY_TOLERANCE) {
      throw new CirculationError(`Charge has only ₹${money(balance)} left to waive`);
    }
    if (await Waiver.exists({ chargeId: charge._id, status: 'PENDING' })) throw new CirculationError(PENDING_EXISTS);
    try {
      const doc = await Waiver.create({ ...base, type: 'REQUEST', status: 'PENDING', approvedAmount: null });
      return doc.toObject();
    } catch (err) {
      if (err?.code === 11000) throw new CirculationError(PENDING_EXISTS); // partial unique index race
      throw err;
    }
  }

  let waiver = null;
  await withSession((session) => session.withTransaction(async () => {
    waiver = null;
    const updated = await chargeModel.applyDelta({ _id: charge._id }, { kind: 'waive', amount }, { session });
    if (!updated) {
      const cur = await chargeModel.findById(charge._id, { session });
      throw new CirculationError(`Charge has only ₹${money(cur ? chargeModel.balanceOf(cur) : 0)} left to waive`);
    }
    const [doc] = await Waiver.create([{
      ...base, type: 'DIRECT', status: 'APPROVED', approvedAmount: amount, decidedBy: oid(userId), decidedAt: now,
    }], { session });
    waiver = doc.toObject();
  }));
  return waiver;
}

// Approve a PENDING request, optionally for less than requested. Applies min(amount, balance).
// Throws "Nothing left to waive" (waiver stays PENDING - the transaction aborts) at balance 0.
async function approveWaiver({ waiverId, amount, note, userId }) {
  let out = null;
  await withSession((session) => session.withTransaction(async () => {
    out = null;
    const now = new Date();
    const waiver = await Waiver.findOne({ _id: waiverId, status: 'PENDING' }).session(session).lean();
    if (!waiver) throw new CirculationError(DECIDED);
    const wanted = amount === undefined || amount === null ? waiver.amount : amount;
    if (wanted > waiver.amount + chargeModel.MONEY_TOLERANCE) throw new CirculationError('Approved amount cannot exceed the requested amount');
    const charge = await chargeModel.findById(waiver.chargeId, { session });
    const balance = charge ? chargeModel.balanceOf(charge) : 0;
    if (balance <= 0) throw new CirculationError('Nothing left to waive');
    const apply = fine.round2(Math.min(wanted, balance));

    const updatedCharge = await chargeModel.applyDelta({ _id: waiver.chargeId }, { kind: 'waive', amount: apply }, { session });
    if (!updatedCharge) throw new CirculationError('The charge changed — please try again');
    const decided = await Waiver.findOneAndUpdate(
      { _id: waiver._id, status: 'PENDING' },
      { $set: { status: 'APPROVED', approvedAmount: apply, decidedBy: oid(userId), decidedAt: now, decisionNote: note || '' } },
      { new: true, session },
    ).lean();
    if (!decided) throw new CirculationError(DECIDED);
    out = { waiver: decided, applied: apply, requested: waiver.amount };
  }));
  return out;
}

// Reject a PENDING request (single conditional update).
async function rejectWaiver({ waiverId, note, userId }) {
  const decided = await Waiver.findOneAndUpdate(
    { _id: waiverId, status: 'PENDING' },
    { $set: { status: 'REJECTED', decidedBy: oid(userId), decidedAt: new Date(), decisionNote: note } },
    { new: true },
  ).lean();
  if (!decided) throw new CirculationError(DECIDED);
  return decided;
}

module.exports = { createWaiver, approveWaiver, rejectWaiver };
