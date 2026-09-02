const { mongoose } = require('../utils/db');

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Deep-convert a lean() result into a plain client-facing object:
//  - ObjectId  → string
//  - `_id`     → `id`
//  - `__v`     dropped
// Keeps Date values intact. Handles arrays and nested docs (populated relations).
function normalize(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  // Bson ObjectId from the raw driver (defensive)
  if (value._bsontype === 'ObjectID' || value._bsontype === 'ObjectId') return value.toString();

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === '__v') continue;
    if (key === '_id') out.id = val instanceof mongoose.Types.ObjectId ? val.toString() : normalize(val);
    else out[key] = normalize(val);
  }
  return out;
}

// Case-insensitive "contains" filter, with the user input escaped so regex
// metacharacters are treated literally (Prisma's `contains` did this for us).
function containsInsensitive(input) {
  const escaped = String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { $regex: escaped, $options: 'i' };
}

const timestamps = { timestamps: true };

// ---------------------------------------------------------------------------
// Schemas — `collection` is pinned to the exact names the Prisma layer used.
// ---------------------------------------------------------------------------

const ROLES = ['ADMIN', 'TEACHER', 'STUDENT'];
const NOTES_STATUSES = ['COMPLETE', 'PARTIAL', 'INCOMPLETE'];

const userSchema = new Schema({
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name:     { type: String, required: true },
  role:     { type: String, enum: ROLES, default: 'TEACHER' },
  batchIds: { type: [{ type: ObjectId, ref: 'Batch' }], default: [] },
  isActive: { type: Boolean, default: true },
}, { ...timestamps, collection: 'User' });

const batchSchema = new Schema({
  name:     { type: String, required: true, unique: true },
  year:     { type: Number, required: true },
  isActive: { type: Boolean, default: true },
}, { ...timestamps, collection: 'Batch' });

const batchWorkingDaysSchema = new Schema({
  batchId:     { type: ObjectId, ref: 'Batch', required: true },
  month:       { type: Number, required: true },
  year:        { type: Number, required: true },
  workingDays: { type: Number, required: true },
}, { ...timestamps, collection: 'BatchWorkingDays' });

const batchApprovalSchema = new Schema({
  batchId: { type: ObjectId, ref: 'Batch', required: true },
  month:   { type: Number, required: true },
  year:    { type: Number, required: true },
}, { ...timestamps, collection: 'BatchApproval' });

const studentSchema = new Schema({
  fullName:  { type: String, required: true },
  regNumber: { type: String, required: true, unique: true },
  password:  { type: String, default: null },
  photo:     { type: String, default: null },
  batchId:   { type: ObjectId, ref: 'Batch', required: true },
  role:      { type: String, enum: ROLES, default: 'STUDENT' },
  isActive:  { type: Boolean, default: true },
}, { ...timestamps, collection: 'Student' });

const ceRecordSchema = new Schema({
  studentId:            { type: ObjectId, ref: 'Student', required: true },
  month:                { type: Number, required: true },
  year:                 { type: Number, required: true },
  physicsMarks:         { type: Number, required: true },
  physicsMax:           { type: Number, default: 100 },
  chemMarks:            { type: Number, required: true },
  chemMax:              { type: Number, default: 100 },
  mathMarks:            { type: Number, required: true },
  mathMax:              { type: Number, default: 100 },
  bioMarks:             { type: Number, required: true },
  bioMax:               { type: Number, default: 100 },
  lang1Marks:           { type: Number, required: true },
  lang1Max:             { type: Number, default: 100 },
  lang2Marks:           { type: Number, required: true },
  lang2Max:             { type: Number, default: 100 },
  psychologyMarks:      { type: Number, default: 0 },
  psychologyMax:        { type: Number, default: 100 },
  computerScienceMarks: { type: Number, default: 0 },
  computerScienceMax:   { type: Number, default: 100 },
  mcqMarks:             { type: Number, default: 0 },
  mcqMax:               { type: Number, default: 100 },
  mcqPct:               { type: Number, required: true },
  attendancePct:        { type: Number, required: true },
  workingDays:          { type: Number, default: 0 },
  leaveDays:            { type: Number, default: 0 },
  hasMedCert:           { type: Boolean, default: false },
  notesStatus:          { type: String, enum: NOTES_STATUSES, required: true },
  theoryScore:          { type: Number, required: true },
  mcqScore:             { type: Number, required: true },
  attendScore:          { type: Number, required: true },
  notesScore:           { type: Number, required: true },
  totalCE:              { type: Number, required: true },
}, { ...timestamps, collection: 'CERecord' });

const weeklyTestSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  weekDate:  { type: Date, required: true },
  testType:  { type: String, default: 'Theory' },
  subject:   { type: String, required: true },
  chapter:   { type: String, default: '' },
  marks:     { type: Number, required: true },
  maxMarks:  { type: Number, required: true },
}, { ...timestamps, collection: 'WeeklyTest' });

const monthlyTestSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  month:     { type: Number, required: true },
  year:      { type: Number, required: true },
  testType:  { type: String, default: 'Theory' },
  subject:   { type: String, required: true },
  marks:     { type: Number, required: true },
  maxMarks:  { type: Number, required: true },
}, { ...timestamps, collection: 'MonthlyTest' });

const remarkSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  teacherId: { type: ObjectId, ref: 'User', required: true },
  category:  { type: String, required: true },
  text:      { type: String, required: true },
  isFlagged: { type: Boolean, default: false },
}, { ...timestamps, collection: 'Remark' });

const auditLogSchema = new Schema({
  userId:      { type: ObjectId, default: null },
  userName:    { type: String, default: null },
  userRole:    { type: String, default: null },
  action:      { type: String, required: true },
  entity:      { type: String, required: true },
  entityId:    { type: String, default: '' },
  description: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'audit_logs' });

// Reuse a compiled model if it already exists (serverless hot-reload safety).
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

module.exports = {
  User:             model('User', userSchema),
  Batch:            model('Batch', batchSchema),
  BatchWorkingDays: model('BatchWorkingDays', batchWorkingDaysSchema),
  BatchApproval:    model('BatchApproval', batchApprovalSchema),
  Student:          model('Student', studentSchema),
  CERecord:         model('CERecord', ceRecordSchema),
  WeeklyTest:       model('WeeklyTest', weeklyTestSchema),
  MonthlyTest:      model('MonthlyTest', monthlyTestSchema),
  Remark:           model('Remark', remarkSchema),
  AuditLog:         model('AuditLog', auditLogSchema),
  normalize,
  containsInsensitive,
};
