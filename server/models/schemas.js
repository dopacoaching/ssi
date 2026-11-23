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

const ROLES = ['ADMIN', 'TEACHER', 'STUDENT', 'LIBRARIAN'];
const NOTES_STATUSES = ['COMPLETE', 'PARTIAL', 'INCOMPLETE'];

const userSchema = new Schema({
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name:     { type: String, required: true },
  role:     { type: String, enum: ROLES, default: 'TEACHER' },
  batchIds: { type: [{ type: ObjectId, ref: 'Batch' }], default: [] },
  isActive: { type: Boolean, default: true },
  libraryCampusId: { type: ObjectId, ref: 'Campus', default: null },
}, { ...timestamps, collection: 'User' });
userSchema.index({ libraryCampusId: 1 }, { name: 'libraryCampusId_1' });

const campusSchema = new Schema({
  name:           { type: String, required: true, unique: true },
  code:           { type: String, required: true, unique: true, uppercase: true },
  libraryName:    { type: String, default: '' },
  receiptAddress: { type: String, default: '' },
  receiptPhone:   { type: String, default: '' },
  openingHours:   { type: String, default: '' },
  shelfLocations: { type: [String], default: [] },
  categories:     { type: [String], default: [] },
  isActive:       { type: Boolean, default: true },
}, { ...timestamps, collection: 'Campus' });

const librarySettingsSchema = new Schema({
  key:                { type: String, default: 'global', unique: true },
  loanDays:           { type: Number, default: 14 },
  finePerDay:         { type: Number, default: 1 },
  maxBooks:           { type: Number, default: 2 },
  maxRenewals:        { type: Number, default: 1 },
  fineBlockThreshold: { type: Number, default: 50 },
}, { ...timestamps, collection: 'LibrarySettings' });

const COPY_STATUSES = ['AVAILABLE', 'ISSUED', 'LOST', 'DAMAGED', 'WITHDRAWN'];

const bookSchema = new Schema({
  campusId:  { type: ObjectId, ref: 'Campus', required: true },
  title:     { type: String, required: true },
  author:    { type: String, default: '' },
  category:  { type: String, default: '' },
  publisher: { type: String, default: '' },
  edition:   { type: String, default: '' },
  isbn:      { type: String, default: '' },
  remarks:   { type: String, default: '' },
  year:      { type: Number, default: null },
  price:     { type: Number, default: null },
  matchKey:  { type: String, default: '' },
}, { ...timestamps, collection: 'Book' });
bookSchema.index({ campusId: 1, matchKey: 1 }, { name: 'campusId_matchKey' });
bookSchema.index({ campusId: 1, title: 1 }, { name: 'campusId_title' });

const bookCopySchema = new Schema({
  campusId:       { type: ObjectId, ref: 'Campus', required: true },
  bookId:         { type: ObjectId, ref: 'Book', required: true },
  catalogNumber:  { type: String, required: true },
  seq:            { type: Number, required: true },
  status:         { type: String, enum: COPY_STATUSES, default: 'AVAILABLE' },
  shelfLocation:  { type: String, default: '' },
  remarks:        { type: String, default: '' },
  withdrawnAt:    { type: Date, default: null },
  withdrawnBy:    { type: ObjectId, ref: 'User', default: null },
  withdrawReason: { type: String, default: '' },
  statusBeforeWithdraw: { type: String, enum: ['AVAILABLE', 'DAMAGED'], default: null },
  // Phase 5: lost / found / repaired
  lostAt:         { type: Date, default: null },
  lostBy:         { type: ObjectId, ref: 'User', default: null },
  lostReason:     { type: String, default: '' },
  lostSource:     { type: String, enum: ['LOAN', 'STOCK_CHECK', null], default: null },
  stockCheckId:   { type: ObjectId, ref: 'StockCheck', default: null },
  repairedAt:     { type: Date, default: null },
  repairedBy:     { type: ObjectId, ref: 'User', default: null },
  foundAt:        { type: Date, default: null },
  foundBy:        { type: ObjectId, ref: 'User', default: null },
},{ ...timestamps, collection: 'BookCopy' });
bookCopySchema.index({ campusId: 1, catalogNumber: 1 }, { unique: true, name: 'campusId_catalogNumber' });
bookCopySchema.index({ bookId: 1 }, { name: 'bookId_1' });
bookCopySchema.index({ campusId: 1, status: 1 }, { name: 'campusId_status' });

const libraryCounterSchema = new Schema({
  campusId: { type: ObjectId, ref: 'Campus', required: true },
  seq:      { type: Number, default: 0 },
  receiptSeq: { type: Number, default: 0 },   // Phase 4: per-campus receipt counter
  // Phase 4: written by returnLoan / createPeriod / cancelPeriod so concurrent ones conflict (no write skew).
  lastReturnAt:       { type: Date, default: null },
  lastPeriodChangeAt: { type: Date, default: null },
}, { ...timestamps, collection: 'LibraryCounter' });
libraryCounterSchema.index({ campusId: 1 }, { unique: true, name: 'campusId_counter' });

// ---------------------------------------------------------------------------
// Library circulation (Phase 3)
// ---------------------------------------------------------------------------

const LOAN_STATUSES = ['OPEN', 'RETURNED', 'LOST'];
const LOAN_CONDITIONS = ['GOOD', 'DAMAGED_MINOR', 'DAMAGED_MAJOR'];
const CHARGE_TYPES = ['LATE', 'DAMAGE', 'LOST'];
const CHARGE_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'WAIVED'];

const renewalSchema = new Schema({
  at:              { type: Date, required: true },
  by:              { type: ObjectId, ref: 'User', required: true },
  previousDueDate: { type: String, required: true },
  newDueDate:      { type: String, required: true },
}, { _id: false });

const loanSchema = new Schema({
  campusId:    { type: ObjectId, ref: 'Campus', required: true },   // the COPY's campus
  copyId:      { type: ObjectId, ref: 'BookCopy', required: true },
  bookId:      { type: ObjectId, ref: 'Book', required: true },
  studentId:   { type: ObjectId, ref: 'Student', required: true },
  issuedAt:    { type: Date, required: true },
  issuedBy:    { type: ObjectId, ref: 'User', required: true },
  dueDate:     { type: String, required: true },                    // YYYY-MM-DD (IST)
  loanDays:    { type: Number, required: true },
  finePerDay:  { type: Number, required: true },
  renewCount:  { type: Number, default: 0 },
  renewals:    { type: [renewalSchema], default: [] },
  status:      { type: String, enum: LOAN_STATUSES, default: 'OPEN' },
  returnedAt:  { type: Date, default: null },
  returnedBy:  { type: ObjectId, ref: 'User', default: null },
  lostAt:      { type: Date, default: null },     // Phase 5
  lostBy:      { type: ObjectId, ref: 'User', default: null },
  foundAt:     { type: Date, default: null },
  foundBy:     { type: ObjectId, ref: 'User', default: null },
  condition:   { type: String, enum: [...LOAN_CONDITIONS, null], default: null },
  fineDays:    { type: Number, default: null },
  fineAmount:  { type: Number, default: null },
  fineWaivedDays: { type: Number, default: 0 },   // Phase 4: total days in waivedRanges
  waivedRanges:   { type: [{ _id: false, from: String, to: String }], default: [] },   // merged, inclusive
  // { issue?: {reason,by,at}, return?: {...} } - left unset (not null) so 'backdated.return' can be $set later.
  backdated:   { type: Schema.Types.Mixed },
}, { ...timestamps, collection: 'Loan' });
loanSchema.index({ copyId: 1 }, { unique: true, name: 'copyId_open_unique', partialFilterExpression: { status: 'OPEN' } });
loanSchema.index({ studentId: 1, status: 1 }, { name: 'studentId_status' });
loanSchema.index({ campusId: 1, status: 1, dueDate: 1 }, { name: 'campusId_status_dueDate' });
loanSchema.index({ bookId: 1, issuedAt: -1 }, { name: 'bookId_issuedAt' });

const chargeSchema = new Schema({
  campusId:     { type: ObjectId, ref: 'Campus', required: true },
  studentId:    { type: ObjectId, ref: 'Student', required: true },
  loanId:       { type: ObjectId, ref: 'Loan', required: true },
  copyId:       { type: ObjectId, ref: 'BookCopy', required: true },
  type:         { type: String, enum: CHARGE_TYPES, required: true },
  amount:       { type: Number, required: true },
  paidAmount:   { type: Number, default: 0 },
  waivedAmount: { type: Number, default: 0 },
  status:       { type: String, enum: CHARGE_STATUSES, default: 'UNPAID' },
  note:         { type: String, default: '' },
  createdBy:    { type: ObjectId, ref: 'User', required: true },
}, { ...timestamps, collection: 'Charge' });
chargeSchema.index({ studentId: 1, status: 1 }, { name: 'studentId_status' });
chargeSchema.index({ campusId: 1, status: 1 }, { name: 'campusId_status' });
chargeSchema.index({ loanId: 1 }, { name: 'loanId_1' });

const libraryStudentStateSchema = new Schema({
  studentId: { type: ObjectId, ref: 'Student', required: true },
  openLoans: { type: Number, default: 0 },
}, { ...timestamps, collection: 'LibraryStudentState' });
libraryStudentStateSchema.index({ studentId: 1 }, { unique: true, name: 'studentId_state' });

// ---------------------------------------------------------------------------
// Library fines & payments (Phase 4)
// ---------------------------------------------------------------------------

const WAIVER_TYPES = ['REQUEST', 'DIRECT', 'BULK'];
const WAIVER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

const paymentAllocationSchema = new Schema({
  chargeId: { type: ObjectId, ref: 'Charge', required: true },
  amount:   { type: Number, required: true },
}, { _id: false });

const paymentSchema = new Schema({
  campusId:      { type: ObjectId, ref: 'Campus', required: true },
  studentId:     { type: ObjectId, ref: 'Student', required: true },
  receiptNumber: { type: String, required: true },
  receiptSeq:    { type: Number, required: true },
  amount:        { type: Number, required: true },
  allocations:   { type: [paymentAllocationSchema], default: [] },
  receivedBy:    { type: ObjectId, ref: 'User', required: true },
  receivedAt:    { type: Date, required: true },
  note:          { type: String, default: '' },
  voided:        { type: Schema.Types.Mixed, default: null },   // { at, by, reason } | null
  requestId:     { type: String },                              // client idempotency key
}, { ...timestamps, collection: 'Payment' });
paymentSchema.index({ campusId: 1, requestId: 1 }, {
  unique: true, name: 'campusId_requestId', partialFilterExpression: { requestId: { $type: 'string' } },
});
paymentSchema.index({ campusId: 1, receiptNumber: 1 }, { unique: true, name: 'campusId_receiptNumber' });
paymentSchema.index({ campusId: 1, receivedAt: -1 }, { name: 'campusId_receivedAt' });
paymentSchema.index({ receivedBy: 1, receivedAt: -1 }, { name: 'receivedBy_receivedAt' });
paymentSchema.index({ studentId: 1, receivedAt: -1 }, { name: 'studentId_receivedAt' });
paymentSchema.index({ 'allocations.chargeId': 1 }, { name: 'allocations_chargeId' });

const waiverSchema = new Schema({
  campusId:       { type: ObjectId, ref: 'Campus', required: true },
  studentId:      { type: ObjectId, ref: 'Student', required: true },
  chargeId:       { type: ObjectId, ref: 'Charge', required: true },
  type:           { type: String, enum: WAIVER_TYPES, required: true },
  amount:         { type: Number, required: true },
  approvedAmount: { type: Number, default: null },
  reason:         { type: String, default: '' },
  status:         { type: String, enum: WAIVER_STATUSES, default: 'PENDING' },
  requestedBy:    { type: ObjectId, ref: 'User', required: true },
  requestedAt:    { type: Date, required: true },
  decidedBy:      { type: ObjectId, ref: 'User', default: null },
  decidedAt:      { type: Date, default: null },
  decisionNote:   { type: String, default: '' },
  finePeriodId:   { type: ObjectId, ref: 'FinePeriod', default: null },
}, { ...timestamps, collection: 'Waiver' });
waiverSchema.index({ campusId: 1, status: 1, requestedAt: -1 }, { name: 'campusId_status_requestedAt' });
waiverSchema.index({ chargeId: 1 }, { name: 'chargeId_1' });
waiverSchema.index({ finePeriodId: 1 }, { name: 'finePeriodId_1' });
// Guard (addition to the contract): at most ONE pending request per charge, enforced by the DB.
waiverSchema.index({ chargeId: 1, status: 1 }, {
  unique: true, name: 'chargeId_status_pending_unique', partialFilterExpression: { status: 'PENDING' },
});

const finePeriodSchema = new Schema({
  campusId:  { type: ObjectId, ref: 'Campus', required: true },
  from:      { type: String, required: true },   // YYYY-MM-DD (IST), inclusive
  to:        { type: String, required: true },   // YYYY-MM-DD (IST), inclusive
  reason:    { type: String, default: '' },
  createdBy: { type: ObjectId, ref: 'User', required: true },
  cancelled: { type: Schema.Types.Mixed, default: null },   // { at, by, reason } | null
}, { ...timestamps, collection: 'FinePeriod' });
finePeriodSchema.index({ campusId: 1, from: 1 }, { name: 'campusId_from' });

// ---------------------------------------------------------------------------
// Library stock check (Phase 5)
// ---------------------------------------------------------------------------

const STOCK_CHECK_STATUSES = ['OPEN', 'CLOSED', 'CANCELLED'];

const stockCheckSchema = new Schema({
  campusId:    { type: ObjectId, ref: 'Campus', required: true },
  status:      { type: String, enum: STOCK_CHECK_STATUSES, default: 'OPEN' },
  startedBy:   { type: ObjectId, ref: 'User', required: true },
  startedAt:   { type: Date, required: true },
  note:        { type: String, default: '' },
  closedBy:    { type: ObjectId, ref: 'User', default: null },
  closedAt:    { type: Date, default: null },
  cancelledBy: { type: ObjectId, ref: 'User', default: null },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: '' },
  expectedCount: { type: Number, default: null },
  missing: { type: [{
    _id: false,
    copyId: { type: ObjectId, ref: 'BookCopy' }, catalogNumber: String, title: String, shelfLocation: String,
    markedLostAt: { type: Date, default: null },
  }], default: [] },
  scanCount:   { type: Number, default: 0 },
}, { ...timestamps, collection: 'StockCheck' });
stockCheckSchema.index({ campusId: 1 }, { unique: true, name: 'campusId_open_unique', partialFilterExpression: { status: 'OPEN' } });
stockCheckSchema.index({ campusId: 1, startedAt: -1 }, { name: 'campusId_startedAt' });

const stockCheckScanSchema = new Schema({
  stockCheckId:  { type: ObjectId, ref: 'StockCheck', required: true },
  campusId:      { type: ObjectId, ref: 'Campus', required: true },
  copyId:        { type: ObjectId, ref: 'BookCopy', required: true },
  catalogNumber: { type: String, required: true },
  statusAtScan:  { type: String, required: true },
  scannedBy:     { type: ObjectId, ref: 'User', required: true },
  scannedAt:     { type: Date, required: true },
}, { ...timestamps, collection: 'StockCheckScan' });
stockCheckScanSchema.index({ stockCheckId: 1, copyId: 1 }, { unique: true, name: 'stockCheckId_copyId' });
stockCheckScanSchema.index({ stockCheckId: 1, scannedAt: -1 }, { name: 'stockCheckId_scannedAt' });

const batchSchema = new Schema({
  name:     { type: String, required: true, unique: true },
  year:     { type: Number, required: true },
  isActive: { type: Boolean, default: true },
  campusId: { type: ObjectId, ref: 'Campus', default: null },
}, { ...timestamps, collection: 'Batch' });
batchSchema.index({ campusId: 1 }, { name: 'campusId_1' });

const batchWorkingDaysSchema = new Schema({
  batchId:     { type: ObjectId, ref: 'Batch', required: true },
  month:       { type: Number, required: true },
  year:        { type: Number, required: true },
  workingDays: { type: Number, required: true },
}, { ...timestamps, collection: 'BatchWorkingDays' });
// One working-days row per batch/period — matches the Prisma @@unique.
batchWorkingDaysSchema.index(
  { batchId: 1, month: 1, year: 1 }, { unique: true, name: 'batchId_month_year' },
);

const batchApprovalSchema = new Schema({
  batchId: { type: ObjectId, ref: 'Batch', required: true },
  month:   { type: Number, required: true },
  year:    { type: Number, required: true },
}, { ...timestamps, collection: 'BatchApproval' });
// One approval row per batch/period — matches the Prisma @@unique.
batchApprovalSchema.index(
  { batchId: 1, month: 1, year: 1 }, { unique: true, name: 'batchId_month_year' },
);

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
auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 }, { name: 'entity_entityId_createdAt' });

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
  Campus:           model('Campus', campusSchema),
  LibrarySettings:  model('LibrarySettings', librarySettingsSchema),
  Book:             model('Book', bookSchema),
  BookCopy:         model('BookCopy', bookCopySchema),
  LibraryCounter:   model('LibraryCounter', libraryCounterSchema),
  Loan:             model('Loan', loanSchema),
  Charge:           model('Charge', chargeSchema),
  LibraryStudentState: model('LibraryStudentState', libraryStudentStateSchema),
  Payment:          model('Payment', paymentSchema),
  Waiver:           model('Waiver', waiverSchema),
  FinePeriod:       model('FinePeriod', finePeriodSchema),
  StockCheck:       model('StockCheck', stockCheckSchema),
  StockCheckScan:   model('StockCheckScan', stockCheckScanSchema),
  STOCK_CHECK_STATUSES,
  WAIVER_TYPES, WAIVER_STATUSES,
  COPY_STATUSES, LOAN_STATUSES, LOAN_CONDITIONS, CHARGE_TYPES, CHARGE_STATUSES,
  normalize,
  containsInsensitive,
};
