const { Student, Batch, CERecord, WeeklyTest, MonthlyTest, normalize, containsInsensitive } = require('./schemas');

// All selects explicitly omit the password field (parity with the old layer).
const BASE_FIELDS = 'fullName regNumber batchId isActive photo createdAt updatedAt';

// ── relation stitching helpers ───────────────────────────────────────────────
// The old Prisma models used `include`/nested `select`; here we batch-load the
// related collections and attach them to the lean student docs before
// normalizing the whole tree in one pass.

async function attachBatch(students) {
  const ids = [...new Set(students.map((s) => String(s.batchId)).filter(Boolean))];
  const batches = await Batch.find({ _id: { $in: ids } }).select('name').lean();
  const byId = new Map(batches.map((b) => [String(b._id), { id: String(b._id), name: b.name }]));
  for (const s of students) s.batch = byId.get(String(s.batchId)) || null;
}

async function attachCE(students, { fields, limit } = {}) {
  const ids = students.map((s) => s._id);
  let query = CERecord.find({ studentId: { $in: ids } }).sort({ year: -1, month: -1 });
  // `studentId` is needed for bucketing; `_id` is dropped to match the old
  // projected shape (Prisma's nested `select` returned no id for these).
  if (fields) query = query.select(`${fields} studentId -_id`);
  const records = await query.lean();
  const byStudent = new Map();
  for (const r of records) {
    const key = String(r.studentId);
    if (fields) delete r.studentId; // not part of the projected shape
    if (!byStudent.has(key)) byStudent.set(key, []);
    const bucket = byStudent.get(key);
    if (limit && bucket.length >= limit) continue;
    bucket.push(r);
  }
  for (const s of students) s.ceRecords = byStudent.get(String(s._id)) || [];
}

async function attachCEAsc(students) {
  const ids = students.map((s) => s._id);
  const records = await CERecord.find({ studentId: { $in: ids } })
    .sort({ year: 1, month: 1 }).lean();
  const byStudent = new Map();
  for (const r of records) {
    const key = String(r.studentId);
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(r);
  }
  for (const s of students) s.ceRecords = byStudent.get(String(s._id)) || [];
}

async function attachTests(students) {
  const ids = students.map((s) => s._id);
  const [weekly, monthly] = await Promise.all([
    WeeklyTest.find({ studentId: { $in: ids } }).sort({ weekDate: 1 }).lean(),
    MonthlyTest.find({ studentId: { $in: ids } }).sort({ year: 1, month: 1 }).lean(),
  ]);
  const w = new Map();
  const m = new Map();
  for (const t of weekly) {
    const k = String(t.studentId);
    if (!w.has(k)) w.set(k, []);
    w.get(k).push(t);
  }
  for (const t of monthly) {
    const k = String(t.studentId);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  for (const s of students) {
    s.weeklyTests = w.get(String(s._id)) || [];
    s.monthlyTests = m.get(String(s._id)) || [];
  }
}

// ── queries ─────────────────────────────────────────────────────────────────

const findByBatch = async (batchId) => {
  const students = await Student.find({ batchId, isActive: true })
    .select(BASE_FIELDS).sort({ regNumber: 1 }).lean();
  await attachBatch(students);
  await attachCE(students, { fields: 'totalCE month year' });
  return normalize(students);
};

const findById = async (id) => {
  const student = await Student.findOne({ _id: id }).select(BASE_FIELDS).lean();
  if (!student) return null;
  await attachBatch([student]);
  return normalize(student);
};

const findByRegNumber = async (regNumber) => {
  const student = await Student.findOne({ regNumber, isActive: true })
    .select(`${BASE_FIELDS} password role`).lean();
  return normalize(student);
};

const findAllActive = async (batchIds) => {
  const where = { isActive: true };
  if (batchIds) where.batchId = { $in: batchIds };
  const students = await Student.find(where)
    .select(BASE_FIELDS).sort({ batchId: 1, regNumber: 1 }).lean();
  await attachBatch(students);
  return normalize(students);
};

const create = (data) =>
  Student.create(data).then((doc) => {
    const obj = doc.toObject();
    delete obj.password;
    delete obj.role;
    return normalize(obj);
  });

const update = async (id, data) => {
  const doc = await Student.findByIdAndUpdate(id, data, { new: true })
    .select(BASE_FIELDS).lean();
  return normalize(doc);
};

const softDelete = (id) =>
  Student.findByIdAndUpdate(id, { isActive: false }, { new: true })
    .select('_id').lean().then(normalize);

const findBatchReport = async (batchId) => {
  const students = await Student.find({ batchId, isActive: true })
    .select(BASE_FIELDS).sort({ regNumber: 1 }).lean();
  await attachBatch(students);
  await attachTests(students);
  await attachCEAsc(students);
  return normalize(students);
};

const search = async (q, batchIds) => {
  const where = {
    isActive: true,
    $or: [
      { fullName: containsInsensitive(q) },
      { regNumber: containsInsensitive(q) },
    ],
  };
  if (batchIds && batchIds.length > 0) where.batchId = { $in: batchIds };
  const students = await Student.find(where)
    .select(BASE_FIELDS).sort({ regNumber: 1 }).limit(10).lean();
  await attachBatch(students);
  return normalize(students);
};

const findAllWithLatestCE = async (batchIds) => {
  const where = { isActive: true };
  if (batchIds && batchIds.length > 0) where.batchId = { $in: batchIds };
  const students = await Student.find(where)
    .select(BASE_FIELDS).sort({ batchId: 1, regNumber: 1 }).lean();
  await attachBatch(students);
  await attachCE(students, { fields: 'totalCE attendancePct month year', limit: 2 });
  return normalize(students);
};

module.exports = {
  findByBatch, findById, findByRegNumber, findAllActive, create, update,
  softDelete, findBatchReport, search, findAllWithLatestCE,
};
