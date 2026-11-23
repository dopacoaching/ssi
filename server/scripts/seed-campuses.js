// Seeds the IG-1 / IG-2 campuses and tags existing batches with them.
// Usage (from server/):  node scripts/seed-campuses.js [--dry-run]
// Idempotent. Never overwrites a batch already tagged with a different campus.
require('dotenv').config();
const { connectDB, mongoose } = require('../utils/db');
// Never let Mongoose build indexes from this script (even when NODE_ENV isn't
// 'production') — indexes are created only by scripts/library-indexes.js.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const { Campus, Batch, AuditLog } = require('../models/schemas');

const DRY_RUN = process.argv.includes('--dry-run');

const CAMPUSES = [
  { name: 'IG-1', code: 'IG1', batches: ['R1', 'R2', 'R3', 'S1', 'S2', 'S3'] },
  { name: 'IG-2', code: 'IG2', batches: ['R4', 'S4', 'S5'] },
];

const norm = (s) => String(s || '').trim().toLowerCase();

async function main() {
  await connectDB();
  console.log(`Seed campuses${DRY_RUN ? ' (dry run - no writes)' : ''}`);

  const report = { campusesCreated: [], campusesExisting: [], tagged: [], alreadyOk: [], conflicts: [], unmatched: [] };

  // 1. Campuses (match by code; never modify existing)
  const campusByCode = new Map();
  for (const def of CAMPUSES) {
    let campus = await Campus.findOne({ code: def.code }).lean();
    if (campus) {
      report.campusesExisting.push(def.code);
    } else if (DRY_RUN) {
      report.campusesCreated.push(`${def.code} (would create)`);
      campus = { _id: null, name: def.name, code: def.code };
    } else {
      const doc = await Campus.create({ name: def.name, code: def.code });
      campus = doc.toObject();
      report.campusesCreated.push(def.code);
    }
    campusByCode.set(def.code, campus);
  }

  // 2. Tag batches (trimmed, case-insensitive name match)
  const batches = await Batch.find().lean();
  const byName = new Map();
  for (const b of batches) {
    const k = norm(b.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(b);
  }

  for (const def of CAMPUSES) {
    const campus = campusByCode.get(def.code);
    const campusId = campus._id;
    for (const batchName of def.batches) {
      const matches = byName.get(norm(batchName)) || [];
      if (matches.length === 0) { report.unmatched.push(`${batchName} (-> ${def.name})`); continue; }
      for (const b of matches) {
        if (b.campusId && (!campusId || String(b.campusId) !== String(campusId))) {
          report.conflicts.push(`${b.name} already tagged with a different campus (${b.campusId}); wanted ${def.name}`);
        } else if (b.campusId) {
          report.alreadyOk.push(b.name);
        } else {
          if (!DRY_RUN) await Batch.updateOne({ _id: b._id, campusId: { $in: [null, undefined] } }, { $set: { campusId } });
          report.tagged.push(`${b.name} -> ${def.name}`);
        }
      }
    }
  }

  // 3. Summary
  const untagged = DRY_RUN
    ? batches.filter((b) => !b.campusId && !report.tagged.some((t) => t.startsWith(`${b.name} ->`)))
    : await Batch.find({ campusId: { $in: [null, undefined] } }).lean();

  const line = (label, arr) => console.log(`  ${label}: ${arr.length}${arr.length ? ` - ${arr.join(', ')}` : ''}`);
  console.log('');
  line('Campuses created', report.campusesCreated);
  line('Campuses already existing', report.campusesExisting);
  line(DRY_RUN ? 'Batches that would be tagged' : 'Batches tagged', report.tagged);
  line('Batches already correctly tagged', report.alreadyOk);
  line('CONFLICTS (left untouched)', report.conflicts);
  line('Mapping names with no matching batch', report.unmatched);
  line('Batches with no campus after run', untagged.map((b) => b.name));

  if (!DRY_RUN) {
    await AuditLog.create({
      userId: null,
      userName: 'system script',
      userRole: null,
      action: 'UPDATE',
      entity: 'Campus',
      entityId: '',
      description: `seed-campuses script: campuses created [${report.campusesCreated.join(', ') || 'none'}]; ` +
        `batches tagged [${report.tagged.join(', ') || 'none'}]; ` +
        `conflicts [${report.conflicts.length}]; unmatched names [${report.unmatched.join(', ') || 'none'}]; ` +
        `batches still without campus [${untagged.map((b) => b.name).join(', ') || 'none'}]`,
    });
    console.log('\nAudit log entry written.');
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
