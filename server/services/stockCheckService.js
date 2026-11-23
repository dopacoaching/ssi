// Library Phase 5: stock-check business logic (scan classification, close snapshot, mark-lost).
// No req/res here - controllers translate CirculationError to HTTP.
const { mongoose } = require('../utils/db');
const { StockCheck, StockCheckScan, BookCopy, Book, Student } = require('../models/schemas');
const loanModel = require('../models/loanModel');
const { CirculationError, withSession } = require('./circulationService');

const ObjectId = mongoose.Types.ObjectId;
const MAX_MARK_LOST = 500;
const RECORDED_STATUSES = ['AVAILABLE', 'ISSUED', 'LOST', 'DAMAGED', 'WITHDRAWN'];

// Pure. `copy` = copy of the check's campus matching the scanned number (or null);
// `existsElsewhere` = a copy with this number exists at another campus.
// -> { result, record } where record=false means the scan is NOT stored.
function classifyScan({ copy, existsElsewhere = false }) {
  if (!copy) return { result: existsElsewhere ? 'WRONG_CAMPUS' : 'NOT_FOUND', record: false };
  if (copy.status === 'AVAILABLE') return { result: 'OK', record: true };
  if (RECORDED_STATUSES.includes(copy.status)) return { result: copy.status, record: true };
  return { result: 'NOT_FOUND', record: false };
}

// Pure. Human message for a scan result.
function scanMessage(result, { catalogNumber = '', regNumber = '' } = {}) {
  switch (result) {
    case 'OK': return `${catalogNumber} scanned`;
    case 'ALREADY_SCANNED': return `${catalogNumber} was already scanned`;
    case 'WRONG_CAMPUS': return 'This copy belongs to another campus';
    case 'NOT_FOUND': return 'No copy with this catalog number';
    case 'ISSUED': return regNumber ? `Marked Issued to ${regNumber} — check the loan` : 'Marked Issued — check the loan';
    case 'LOST': return 'Marked Lost — use Mark found';
    case 'DAMAGED': return 'Marked Damaged — repair it or leave it as is';
    case 'WITHDRAWN': return 'Marked Withdrawn — this copy is not in circulation';
    default: return result;
  }
}

// Pure. Missing copies = AVAILABLE copies with no scan. `copies` raw lean docs, `scannedIds` Set<string>.
function computeMissing(copies, scannedIds, titleByBookId = new Map()) {
  return copies
    .filter((c) => c.status === 'AVAILABLE' && !scannedIds.has(String(c._id)))
    .sort((a, b) => (a.shelfLocation || '').localeCompare(b.shelfLocation || '') || (a.seq || 0) - (b.seq || 0))
    .map((c) => ({
      copyId: c._id, catalogNumber: c.catalogNumber, title: titleByBookId.get(String(c.bookId)) || '',
      shelfLocation: c.shelfLocation || '', markedLostAt: null,
    }));
}

async function start({ campusId, userId, note }) {
  try {
    const doc = await StockCheck.create({
      campusId, status: 'OPEN', startedBy: userId, startedAt: new Date(), note: note || '', scanCount: 0, missing: [],
    });
    return doc.toObject();
  } catch (err) {
    if (err?.code === 11000) throw new CirculationError('A stock check is already open for this campus');
    throw err;
  }
}

// Returns { result, message, copy, scanCount }. `check` is the raw OPEN check.
async function scan({ check, catalogNumber, userId }) {
  if (check.status !== 'OPEN') throw new CirculationError('This stock check is not open');
  const copy = await BookCopy.findOne({ campusId: check.campusId, catalogNumber }).lean();
  const elsewhere = copy ? false : !!(await BookCopy.exists({ catalogNumber, campusId: { $ne: check.campusId } }));
  const cls = classifyScan({ copy, existsElsewhere: elsewhere });
  if (!cls.record) {
    return { result: cls.result, message: scanMessage(cls.result), copy: null, scanCount: check.scanCount };
  }

  const book = await Book.findById(copy.bookId).select('title').lean();
  const view = { id: String(copy._id), catalogNumber: copy.catalogNumber, status: copy.status,
    shelfLocation: copy.shelfLocation || '', title: book?.title || '' };

  try {
    await StockCheckScan.create({
      stockCheckId: check._id, campusId: check.campusId, copyId: copy._id, catalogNumber: copy.catalogNumber,
      statusAtScan: copy.status, scannedBy: new ObjectId(String(userId)), scannedAt: new Date(),
    });
  } catch (err) {
    if (err?.code === 11000) {
      const cur = await StockCheck.findById(check._id).select('scanCount').lean();
      return { result: 'ALREADY_SCANNED', message: scanMessage('ALREADY_SCANNED', copy), copy: view, scanCount: cur?.scanCount ?? check.scanCount };
    }
    throw err;
  }
  const updated = await StockCheck.findOneAndUpdate(
    { _id: check._id, status: 'OPEN' }, { $inc: { scanCount: 1 } }, { new: true },
  ).select('scanCount').lean();
  if (!updated) {
    // Closed / cancelled while we were scanning: drop the orphan scan.
    await StockCheckScan.deleteOne({ stockCheckId: check._id, copyId: copy._id });
    throw new CirculationError('This stock check is not open');
  }
  let regNumber = '';
  if (cls.result === 'ISSUED') {
    const loan = await loanModel.findOpenByCopy(copy._id);
    if (loan) {
      regNumber = (await Student.findById(loan.studentId).select('regNumber').lean())?.regNumber || '';
    }
  }
  return { result: cls.result, message: scanMessage(cls.result, { catalogNumber: copy.catalogNumber, regNumber }), copy: view, scanCount: updated.scanCount };
}

async function undoScan({ check, copyId }) {
  if (check.status !== 'OPEN') throw new CirculationError('This stock check is not open');
  const removed = await StockCheckScan.findOneAndDelete({ stockCheckId: check._id, copyId }).lean();
  if (!removed) return null;
  const updated = await StockCheck.findOneAndUpdate(
    { _id: check._id, status: 'OPEN' }, { $inc: { scanCount: -1 } }, { new: true },
  ).select('scanCount').lean();
  return { scanCount: updated ? Math.max(0, updated.scanCount) : check.scanCount - 1, removed };
}

// One transaction: OPEN -> CLOSED (conditional; writes the check doc so concurrent scans conflict
// and retry), then the missing snapshot. Retry-safe. Returns { check, missing }.
async function close({ checkId, userId }) {
  let out = null;
  await withSession((session) => session.withTransaction(async () => {
    out = null;
    const now = new Date();
    const closed = await StockCheck.findOneAndUpdate(
      { _id: checkId, status: 'OPEN' },
      { $set: { status: 'CLOSED', closedBy: new ObjectId(String(userId)), closedAt: now } },
      { new: true, session },
    ).lean();
    if (!closed) throw new CirculationError('This stock check is not open');
    const [copies, scanned] = await Promise.all([
      BookCopy.find({ campusId: closed.campusId, status: 'AVAILABLE' }).select('catalogNumber bookId seq shelfLocation status').session(session).lean(),
      StockCheckScan.find({ stockCheckId: closed._id }).select('copyId').session(session).lean(),
    ]);
    const books = await Book.find({ _id: { $in: [...new Set(copies.map((c) => String(c.bookId)))] } }).select('title').session(session).lean();
    const titles = new Map(books.map((b) => [String(b._id), b.title]));
    const missing = computeMissing(copies, new Set(scanned.map((s) => String(s.copyId))), titles);
    out = await StockCheck.findOneAndUpdate(
      { _id: closed._id }, { $set: { missing, expectedCount: copies.length } }, { new: true, session },
    ).lean();
  }));
  return out;
}

async function cancel({ checkId, userId, reason }) {
  const doc = await StockCheck.findOneAndUpdate(
    { _id: checkId, status: 'OPEN' },
    { $set: { status: 'CANCELLED', cancelledBy: new ObjectId(String(userId)), cancelledAt: new Date(), cancelReason: reason } },
    { new: true },
  ).lean();
  if (!doc) throw new CirculationError('This stock check is not open');
  return doc;
}

// Marks missing copies lost (no charges). `check` is the raw CLOSED check, `copyIds` strings
// already validated as distinct ObjectIds. Returns { marked: copies[], skipped: [{copyId, catalogNumber, status}] }.
async function markLost({ check, copyIds, reason, userId }) {
  if (check.status !== 'CLOSED') throw new CirculationError('Copies can only be marked lost from a closed stock check');
  const missingBy = new Map((check.missing || []).map((m) => [String(m.copyId), m]));
  for (const id of copyIds) {
    if (!missingBy.has(id)) throw new CirculationError('Some selected copies are not in this stock check\'s missing list');
  }
  const pending = copyIds.filter((id) => !missingBy.get(id).markedLostAt);
  const already = copyIds.filter((id) => missingBy.get(id).markedLostAt);
  const now = new Date();
  const by = new ObjectId(String(userId));
  if (pending.length) {
    await BookCopy.bulkWrite(pending.map((id) => ({
      updateOne: {
        filter: { _id: new ObjectId(id), campusId: check.campusId, status: 'AVAILABLE' },
        update: { $set: { status: 'LOST', lostAt: now, lostBy: by, lostReason: reason, lostSource: 'STOCK_CHECK', stockCheckId: check._id } },
      },
    })), { ordered: false });
  }
  const copies = await BookCopy.find({ _id: { $in: copyIds } }).select('catalogNumber status lostAt stockCheckId').lean();
  const isMine = (c) => c.status === 'LOST' && String(c.stockCheckId) === String(check._id)
    && c.lostAt && c.lostAt.getTime() === now.getTime();
  const marked = copies.filter(isMine);
  const alreadySet = new Set(already);
  const skipped = copies.filter((c) => !isMine(c)).map((c) => ({
    copyId: String(c._id), catalogNumber: c.catalogNumber, status: alreadySet.has(String(c._id)) ? 'LOST' : c.status,
  }));
  if (marked.length) {
    await StockCheck.updateOne(
      { _id: check._id },
      { $set: { 'missing.$[m].markedLostAt': now } },
      { arrayFilters: [{ 'm.copyId': { $in: marked.map((c) => c._id) } }] },
    );
  }
  return { marked, skipped };
}

module.exports = {
  MAX_MARK_LOST, classifyScan, scanMessage, computeMissing, start, scan, undoScan, close, cancel, markLost,
};
