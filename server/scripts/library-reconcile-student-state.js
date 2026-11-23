// Recomputes LibraryStudentState.openLoans from the actual OPEN loans of every student.
// Usage (from server/):  node scripts/library-reconcile-student-state.js [--dry-run]
// Idempotent. --dry-run only lists the mismatches. Students with no state row and no open
// loans are left alone; students with open loans but no state row get one created.
require('dotenv').config();
const { connectDB, mongoose } = require('../utils/db');
// Never let Mongoose build indexes from this script - indexes come from scripts/library-indexes.js.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const { Loan, LibraryStudentState } = require('../models/schemas');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await connectDB();
  console.log(`Reconcile library student state${DRY_RUN ? ' (dry run - no writes)' : ''}`);

  const actualRows = await Loan.aggregate([
    { $match: { status: 'OPEN' } },
    { $group: { _id: '$studentId', n: { $sum: 1 } } },
  ]);
  const actual = new Map(actualRows.map((r) => [String(r._id), r.n]));
  const states = await LibraryStudentState.find({}).select('studentId openLoans').lean();
  const stateBy = new Map(states.map((s) => [String(s.studentId), s]));

  const ops = [];
  const mismatches = [];
  for (const s of states) {
    const want = actual.get(String(s.studentId)) || 0;
    if ((s.openLoans || 0) !== want) {
      mismatches.push(`student ${s.studentId}: stored ${s.openLoans} -> actual ${want}`);
      ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: { openLoans: want } } } });
    }
  }
  for (const [studentId, n] of actual) {
    if (!stateBy.has(studentId)) {
      mismatches.push(`student ${studentId}: no state row -> actual ${n}`);
      ops.push({ updateOne: {
        filter: { studentId: new mongoose.Types.ObjectId(studentId) },
        update: { $set: { openLoans: n } },
        upsert: true,
      } });
    }
  }

  mismatches.forEach((m) => console.log(`  [mismatch] ${m}`));
  if (!DRY_RUN && ops.length) await LibraryStudentState.bulkWrite(ops, { ordered: false });
  console.log(`\nSummary: ${states.length} state rows, ${actual.size} students with open loans, ${mismatches.length} mismatches${DRY_RUN ? ' (not fixed)' : ' fixed'}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
