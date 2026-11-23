// Library Phase 5: stock checks (resumable, server-side, one OPEN check per campus).
const { mongoose } = require('../utils/db');
const campusModel = require('../models/campusModel');
const { StockCheck, StockCheckScan, BookCopy, Book, User, normalize } = require('../models/schemas');
const stock = require('../services/stockCheckService');
const { assertCampusAccess } = require('../middleware/libraryScope');
const { cleanObjectId, cleanRequiredText, cleanOptionalText } = require('../utils/fineValidation');
const { logAudit, logAuditMany, logError } = require('../utils/audit');
const { ok, created, badRequest, forbidden, notFound } = require('../views/response');
const { resolveCampus, readScope, deny, failure } = require('./circulationController');

const ObjectId = mongoose.Types.ObjectId;
const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];

// StockCheckView[] (campus / users stitched in batched queries). `missing` is [] unless CLOSED.
async function shapeMany(docs, { brief = false } = {}) {
  if (docs.length === 0) return [];
  const [campuses, users] = await Promise.all([
    campusModel.summariesByIds(docs.map((d) => d.campusId)),
    User.find({ _id: { $in: uniq(docs.flatMap((d) => [d.startedBy, d.closedBy, d.cancelledBy])) } }).select('name').lean(),
  ]);
  const name = new Map(users.map((u) => [String(u._id), u.name]));
  const person = (id) => (id ? { id: String(id), name: name.get(String(id)) || 'Unknown' } : null);
  return docs.map((d) => ({
    id: String(d._id),
    campus: campuses.get(String(d.campusId)) || null,
    status: d.status,
    note: d.note || '',
    startedBy: person(d.startedBy), startedAt: d.startedAt,
    closedBy: person(d.closedBy), closedAt: d.closedAt || null,
    cancelledBy: person(d.cancelledBy), cancelledAt: d.cancelledAt || null,
    cancelReason: d.cancelReason || '',
    scanCount: d.scanCount || 0,
    expectedCount: d.expectedCount ?? null,
    missingCount: d.status === 'CLOSED' ? (d.missing || []).length : 0,
    missing: d.status === 'CLOSED' && !brief
      ? (d.missing || []).map((m) => ({
        copyId: String(m.copyId), catalogNumber: m.catalogNumber, title: m.title || '',
        shelfLocation: m.shelfLocation || '', markedLostAt: m.markedLostAt || null,
      }))
      : [],
  }));
}

async function shapeScans(docs) {
  if (docs.length === 0) return [];
  const copies = await BookCopy.find({ _id: { $in: uniq(docs.map((d) => d.copyId)) } }).select('bookId').lean();
  const [books, users] = await Promise.all([
    Book.find({ _id: { $in: uniq(copies.map((c) => c.bookId)) } }).select('title').lean(),
    User.find({ _id: { $in: uniq(docs.map((d) => d.scannedBy)) } }).select('name').lean(),
  ]);
  const copyBook = new Map(copies.map((c) => [String(c._id), String(c.bookId)]));
  const title = new Map(books.map((b) => [String(b._id), b.title]));
  const name = new Map(users.map((u) => [String(u._id), u.name]));
  return docs.map((d) => ({
    copyId: String(d.copyId), catalogNumber: d.catalogNumber,
    title: title.get(copyBook.get(String(d.copyId))) || '',
    statusAtScan: d.statusAtScan,
    scannedBy: { id: String(d.scannedBy), name: name.get(String(d.scannedBy)) || 'Unknown' },
    scannedAt: d.scannedAt,
  }));
}

// Loads :id with campus scoping; sends the response and returns null on failure.
async function loadCheck(req, res) {
  const id = cleanObjectId(req.params.id, 'stock check');
  if (id.error) { notFound(res, 'Stock check not found'); return null; }
  const doc = await StockCheck.findById(id.value).lean();
  if (!doc) { notFound(res, 'Stock check not found'); return null; }
  if (!assertCampusAccess(req, doc.campusId)) { deny(req, res, 'stock check'); return null; }
  return doc;
}

const codeOf = async (campusId) => (await campusModel.summariesByIds([campusId])).get(String(campusId))?.code || '';

async function list(req, res) {
  const s = readScope(req, req.query.campusId);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'stock checks');
  const page = Math.min(10000, Math.max(1, parseInt(req.query.page, 10) || 1));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const [total, docs] = await Promise.all([
    StockCheck.countDocuments(s.scope),
    StockCheck.find(s.scope).sort({ startedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return ok(res, { items: await shapeMany(docs, { brief: true }), total, page, limit });
}

async function start(req, res) {
  const body = req.body || {};
  const r = await resolveCampus(req, body.campusId);
  if (r.fail) return r.fail(res);
  const note = cleanOptionalText(body.note, 'Note', 500);
  if (note.error) return badRequest(res, note.error);
  let doc;
  try {
    doc = await stock.start({ campusId: new ObjectId(r.campus.id), userId: new ObjectId(String(req.user.id)), note: note.value });
  } catch (err) {
    return failure(res, err);
  }
  await logAudit(req, 'CREATE', 'StockCheck', String(doc._id), `Started stock check ${r.campus.code}`);
  return created(res, (await shapeMany([doc]))[0]);
}

async function getOne(req, res) {
  const doc = await loadCheck(req, res);
  if (!doc) return;
  const [expectedRows, scannedRows, recent] = await Promise.all([
    BookCopy.aggregate([
      { $match: { campusId: doc.campusId, status: 'AVAILABLE' } },
      { $group: { _id: '$shelfLocation', n: { $sum: 1 } } },
    ]),
    StockCheckScan.aggregate([
      { $match: { stockCheckId: doc._id } },
      { $lookup: { from: BookCopy.collection.name, localField: 'copyId', foreignField: '_id', as: '_c' } },
      { $group: { _id: { $ifNull: [{ $arrayElemAt: ['$_c.shelfLocation', 0] }, ''] }, n: { $sum: 1 } } },
    ]),
    StockCheckScan.find({ stockCheckId: doc._id }).sort({ scannedAt: -1 }).limit(20).lean(),
  ]);
  const shelves = new Map();
  const slot = (k) => {
    const key = k || '';
    if (!shelves.has(key)) shelves.set(key, { shelf: key, expected: 0, scanned: 0 });
    return shelves.get(key);
  };
  for (const r of expectedRows) slot(r._id).expected = r.n;
  for (const r of scannedRows) slot(r._id).scanned = r.n;
  const progress = [...shelves.values()].sort((a, b) => (a.shelf || '￿').localeCompare(b.shelf || '￿'));
  const [view] = await shapeMany([doc]);
  return ok(res, { ...view, progress, recentScans: await shapeScans(recent) });
}

async function scan(req, res) {
  const doc = await loadCheck(req, res);
  if (!doc) return;
  const cn = (req.body || {}).catalogNumber;
  if (typeof cn !== 'string' || !cn.trim()) return badRequest(res, 'Catalog number is required');
  const catalogNumber = cn.trim().toUpperCase();
  if (catalogNumber.length > 40) return badRequest(res, 'Catalog number is too long');
  try {
    return ok(res, await stock.scan({ check: doc, catalogNumber, userId: req.user.id }));
  } catch (err) {
    return failure(res, err);
  }
}

async function undoScan(req, res) {
  const doc = await loadCheck(req, res);
  if (!doc) return;
  const cid = cleanObjectId(req.params.copyId, 'copy');
  if (cid.error) return badRequest(res, cid.error);
  let out;
  try {
    out = await stock.undoScan({ check: doc, copyId: new ObjectId(cid.value) });
  } catch (err) {
    return failure(res, err);
  }
  if (!out) return notFound(res, 'That copy has not been scanned');
  return ok(res, { scanCount: out.scanCount });
}

async function close(req, res) {
  const doc = await loadCheck(req, res);
  if (!doc) return;
  let closed;
  try {
    closed = await stock.close({ checkId: doc._id, userId: req.user.id });
  } catch (err) {
    return failure(res, err);
  }
  // ---- committed: from here on NEVER return an error ----
  const code = await codeOf(doc.campusId).catch(() => '');
  await logAudit(req, 'UPDATE', 'StockCheck', String(doc._id),
    `Closed stock check ${code} — ${closed.scanCount.toLocaleString('en-US')} scanned, ${closed.missing.length} missing`);
  try {
    return ok(res, (await shapeMany([closed]))[0]);
  } catch (err) {
    console.error('[stock-check] post-close response build', err);
    return ok(res, { id: String(doc._id), status: closed.status, scanCount: closed.scanCount }, 'Closed — refresh to see the result');
  }
}

async function cancel(req, res) {
  if (!req.library.isAdmin) {
    logError(req, 403, `Non-admin attempted to cancel a stock check - ${req.method} ${req.originalUrl}`);
    return forbidden(res, 'Only an administrator can do this');
  }
  const doc = await loadCheck(req, res);
  if (!doc) return;
  const reason = cleanRequiredText((req.body || {}).reason, 'Reason');
  if (reason.error) return badRequest(res, reason.error);
  let cancelled;
  try {
    cancelled = await stock.cancel({ checkId: doc._id, userId: req.user.id, reason: reason.value });
  } catch (err) {
    return failure(res, err);
  }
  const code = await codeOf(doc.campusId).catch(() => '');
  await logAudit(req, 'UPDATE', 'StockCheck', String(doc._id), `Cancelled stock check ${code} — reason: ${reason.value}`);
  try {
    return ok(res, (await shapeMany([cancelled]))[0]);
  } catch (err) {
    console.error('[stock-check] post-cancel response build', err);
    return ok(res, { id: String(doc._id), status: cancelled.status }, 'Cancelled — refresh to see the result');
  }
}

async function markLost(req, res) {
  const doc = await loadCheck(req, res);
  if (!doc) return;
  const body = req.body || {};
  if (!Array.isArray(body.copyIds) || body.copyIds.length < 1 || body.copyIds.length > stock.MAX_MARK_LOST) {
    return badRequest(res, `Select between 1 and ${stock.MAX_MARK_LOST} copies`);
  }
  for (const id of body.copyIds) {
    if (cleanObjectId(id, 'copy').error) return badRequest(res, 'Invalid copy');
  }
  const copyIds = uniq(body.copyIds);
  const reason = cleanRequiredText(body.reason, 'Reason', 300);
  if (reason.error) return badRequest(res, reason.error);

  let out;
  try {
    out = await stock.markLost({ check: doc, copyIds, reason: reason.value, userId: req.user.id });
  } catch (err) {
    return failure(res, err);
  }

  // ---- committed: from here on NEVER return an error ----
  if (out.marked.length) {
    const code = await codeOf(doc.campusId).catch(() => '');
    const n = out.marked.length;
    await logAuditMany(req, [
      { action: 'UPDATE', entity: 'StockCheck', entityId: doc._id,
        description: `Marked ${n} cop${n === 1 ? 'y' : 'ies'} lost from stock check ${code} — reason: ${reason.value}` },
      ...out.marked.map((c) => ({
        action: 'UPDATE', entity: 'BookCopy', entityId: c._id,
        description: `Marked lost ${c.catalogNumber} (stock check ${code}) — reason: ${reason.value}`,
      })),
    ]);
  }
  return ok(res, { marked: out.marked.length, skipped: out.skipped });
}

module.exports = { list, start, getOne, scan, undoScan, close, cancel, markLost, shapeMany };
