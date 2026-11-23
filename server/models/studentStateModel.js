const { Loan, LibraryStudentState } = require('./schemas');

// Per-student open-loan counter used as the atomic gate for the "max books" limit.
// ensure() seeds the doc from the REAL open-loan count the first time (so existing
// data is never ignored); a concurrent first-time upsert race (E11000) is harmless.
const ensure = async (studentId) => {
  if (await LibraryStudentState.exists({ studentId })) return;
  const openLoans = await Loan.countDocuments({ studentId, status: 'OPEN' });
  try {
    await LibraryStudentState.updateOne(
      { studentId },
      { $setOnInsert: { studentId, openLoans } },
      { upsert: true },
    );
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
};

// Atomic gate: increments only while openLoans < max. Returns the doc or null (limit reached).
const tryIncrement = (studentId, max, { session } = {}) =>
  LibraryStudentState.findOneAndUpdate(
    { studentId, openLoans: { $lt: max } },
    { $inc: { openLoans: 1 } },
    { new: true, session },
  ).lean();

// Never goes below zero.
const decrement = (studentId, { session } = {}) =>
  LibraryStudentState.updateOne(
    { studentId, openLoans: { $gt: 0 } },
    { $inc: { openLoans: -1 } },
    { session },
  );

module.exports = { ensure, tryIncrement, decrement };
