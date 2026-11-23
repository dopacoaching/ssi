const { LibraryCounter } = require('../models/schemas');

// `${code}-${seq padded to 5}` e.g. IG1-00001 (wider seqs just grow).
const format = (code, seq) => `${code}-${String(seq).padStart(5, '0')}`;

// Atomically reserve n sequence numbers for a campus with ONE $inc.
// Returns an array [first .. last]. Numbers are never reused (gaps on failure are fine).
async function reserve(campusId, n, { session } = {}) {
  if (!Number.isInteger(n) || n < 1) throw new Error('reserve: n must be a positive integer');
  const doc = await LibraryCounter.findOneAndUpdate(
    { campusId },
    { $inc: { seq: n } },
    { upsert: true, new: true, setDefaultsOnInsert: false, session },
  ).lean();
  const last = doc.seq;
  const first = last - n + 1;
  return Array.from({ length: n }, (_, i) => first + i);
}

module.exports = { format, reserve };
