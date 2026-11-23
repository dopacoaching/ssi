// Creates the Library-module indexes (production runs with autoIndex off).
// Usage (from server/):  node scripts/library-indexes.js [--dry-run]
// Idempotent. Later phases: append more specs to INDEX_SPECS.
require('dotenv').config();
const { connectDB, mongoose } = require('../utils/db');

const DRY_RUN = process.argv.includes('--dry-run');

// { collection, keys, name, unique?, partial? }  (partial = partialFilterExpression)
const INDEX_SPECS = [
  { collection: 'Campus',          keys: { name: 1 },            name: 'name_1',            unique: true },
  { collection: 'Campus',          keys: { code: 1 },            name: 'code_1',            unique: true },
  { collection: 'LibrarySettings', keys: { key: 1 },             name: 'key_1',             unique: true },
  { collection: 'Batch',           keys: { campusId: 1 },        name: 'campusId_1' },
  { collection: 'User',            keys: { libraryCampusId: 1 }, name: 'libraryCampusId_1' },
  // Phase 2 — catalog
  { collection: 'BookCopy',        keys: { campusId: 1, catalogNumber: 1 }, name: 'campusId_catalogNumber', unique: true },
  { collection: 'BookCopy',        keys: { bookId: 1 },          name: 'bookId_1' },
  { collection: 'BookCopy',        keys: { campusId: 1, status: 1 }, name: 'campusId_status' },
  { collection: 'Book',            keys: { campusId: 1, matchKey: 1 }, name: 'campusId_matchKey' },
  { collection: 'Book',            keys: { campusId: 1, title: 1 }, name: 'campusId_title' },
  { collection: 'audit_logs',      keys: { entity: 1, entityId: 1, createdAt: -1 }, name: 'entity_entityId_createdAt' },
  { collection: 'LibraryCounter', keys: { campusId: 1 },        name: 'campusId_counter', unique: true },
  // Phase 3 - circulation
  { collection: 'Loan',            keys: { copyId: 1 },          name: 'copyId_open_unique', unique: true, partial: { status: 'OPEN' } },
  { collection: 'Loan',            keys: { studentId: 1, status: 1 }, name: 'studentId_status' },
  { collection: 'Loan',            keys: { campusId: 1, status: 1, dueDate: 1 }, name: 'campusId_status_dueDate' },
  { collection: 'Loan',            keys: { bookId: 1, issuedAt: -1 }, name: 'bookId_issuedAt' },
  { collection: 'Charge',          keys: { studentId: 1, status: 1 }, name: 'studentId_status' },
  { collection: 'Charge',          keys: { campusId: 1, status: 1 }, name: 'campusId_status' },
  { collection: 'Charge',          keys: { loanId: 1 },          name: 'loanId_1' },
  { collection: 'LibraryStudentState', keys: { studentId: 1 },   name: 'studentId_state', unique: true },
  // Phase 4 - fines & payments
  { collection: 'Payment',         keys: { campusId: 1, receiptNumber: 1 }, name: 'campusId_receiptNumber', unique: true },
  { collection: 'Payment',         keys: { campusId: 1, requestId: 1 }, name: 'campusId_requestId', unique: true, partial: { requestId: { $type: 'string' } } },
  { collection: 'Payment',         keys: { campusId: 1, receivedAt: -1 }, name: 'campusId_receivedAt' },
  { collection: 'Payment',         keys: { receivedBy: 1, receivedAt: -1 }, name: 'receivedBy_receivedAt' },
  { collection: 'Payment',         keys: { studentId: 1, receivedAt: -1 }, name: 'studentId_receivedAt' },
  { collection: 'Payment',         keys: { 'allocations.chargeId': 1 }, name: 'allocations_chargeId' },
  { collection: 'Waiver',          keys: { campusId: 1, status: 1, requestedAt: -1 }, name: 'campusId_status_requestedAt' },
  { collection: 'Waiver',          keys: { chargeId: 1 },        name: 'chargeId_1' },
  { collection: 'Waiver',          keys: { finePeriodId: 1 },    name: 'finePeriodId_1' },
  { collection: 'Waiver',          keys: { chargeId: 1, status: 1 }, name: 'chargeId_status_pending_unique', unique: true, partial: { status: 'PENDING' } },
  { collection: 'FinePeriod',      keys: { campusId: 1, from: 1 }, name: 'campusId_from' },
  // Phase 5 - stock check
  { collection: 'StockCheck',      keys: { campusId: 1 },        name: 'campusId_open_unique', unique: true, partial: { status: 'OPEN' } },
  { collection: 'StockCheck',      keys: { campusId: 1, startedAt: -1 }, name: 'campusId_startedAt' },
  { collection: 'StockCheckScan',  keys: { stockCheckId: 1, copyId: 1 }, name: 'stockCheckId_copyId', unique: true },
  { collection: 'StockCheckScan',  keys: { stockCheckId: 1, scannedAt: -1 }, name: 'stockCheckId_scannedAt' },
];

const sameKeys = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Returns duplicate groups for a unique index (null/missing values excluded).
async function findDuplicates(coll, keys, partial) {
  const fields = Object.keys(keys);
  const match = { ...(partial || {}) };   // a partial unique index only constrains matching docs
  const id = {};
  for (const f of fields) { match[f] = { $ne: null }; id[f] = `$${f}`; }
  return coll.aggregate([
    { $match: match },
    { $group: { _id: fields.length === 1 ? `$${fields[0]}` : id, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 10 },
  ]).toArray();
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  console.log(`Library indexes${DRY_RUN ? ' (dry run - no changes)' : ''}`);

  const existingNames = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const summary = { existing: 0, created: 0, wouldCreate: 0, skipped: 0 };

  for (const spec of INDEX_SPECS) {
    const label = `${spec.collection}.${spec.name}`;
    const coll = db.collection(spec.collection);
    const indexes = existingNames.has(spec.collection) ? await coll.indexes() : [];
    const found = indexes.find((i) => i.name === spec.name || sameKeys(i.key, spec.keys));

    if (found) {
      const mismatch = !!found.unique !== !!spec.unique
        || JSON.stringify(found.partialFilterExpression || null) !== JSON.stringify(spec.partial || null);
      console.log(`  [exists]  ${label}${found.name !== spec.name ? ` (as "${found.name}")` : ''}${mismatch ? '  WARNING: uniqueness/partial filter differs from spec' : ''}`);
      summary.existing++;
      continue;
    }

    if (spec.unique && existingNames.has(spec.collection)) {
      const dupes = await findDuplicates(coll, spec.keys, spec.partial);
      if (dupes.length > 0) {
        console.log(`  [ABORT]   ${label}: duplicate values exist - ${dupes.map((d) => `${typeof d._id === 'object' ? JSON.stringify(d._id) : `"${d._id}"`} x${d.n}`).join(', ')}. Fix them and re-run.`);
        summary.skipped++;
        continue;
      }
    }

    if (DRY_RUN) {
      console.log(`  [would create] ${label}${spec.unique ? ' (unique)' : ''}`);
      summary.wouldCreate++;
      continue;
    }

    await coll.createIndex(spec.keys, {
      name: spec.name, unique: !!spec.unique, background: true,
      ...(spec.partial ? { partialFilterExpression: spec.partial } : {}),
    });
    console.log(`  [created] ${label}${spec.unique ? ' (unique)' : ''}`);
    summary.created++;
  }

  console.log(`\nSummary: ${summary.existing} existing, ${summary.created} created, ${summary.wouldCreate} would be created, ${summary.skipped} skipped (duplicates)`);
  if (summary.skipped > 0) process.exitCode = 1;
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
