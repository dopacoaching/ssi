const { mongoose } = require('../utils/db');
const campusModel = require('../models/campusModel');
const bookModel = require('../models/bookModel');
const bookCopyModel = require('../models/bookCopyModel');
const loanModel = require('../models/loanModel');
const librarySettingsModel = require('../models/librarySettingsModel');
const { COPY_STATUSES, Book, Student } = require('../models/schemas');
const circulationService = require('../services/circulationService');
const fine = require('../services/fineService');
const { cleanOptionalText } = require('../utils/fineValidation');
const { assertCampusAccess, campusFilter } = require('../middleware/libraryScope');
const { reserve, format } = require('../utils/catalogNumber');
const {
  matchKey, cleanText, listCapacityError, canonicalizer, cleanCopies, validateBookFields, validateBulkRows,
} = require('../utils/catalogValidation');
const { logAudit, logAuditMany, logError } = require('../utils/audit');
const { ok, created, badRequest, forbidden, notFound } = require('../views/response');

const MAX_BULK_ROWS = 1000;
const MAX_BULK_COPIES = 5000;     // sanity cap per import (one transaction)
const EDITABLE_BOOK_FIELDS = ['title', 'author', 'category', 'publisher', 'edition', 'year', 'isbn', 'price', 'remarks'];
const ObjectId = mongoose.Types.ObjectId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isBlank = (v) => v === undefined || v === null || v === '';

function deny(req, res, what) {
  logError(req, 403, `Library user attempted to access another campus's ${what} — ${req.method} ${req.originalUrl}`);
  return forbidden(res, 'You can only manage your own campus');
}

// Resolves the campus a WRITE (or admin-required read) acts on.
// Returns { campus } or { fail: (res) => response }.
async function resolveCampus(req, rawCampusId, { required = true } = {}) {
  if (!req.library.isAdmin) {
    if (!isBlank(rawCampusId) && !assertCampusAccess(req, rawCampusId)) {
      return { fail: (res) => deny(req, res, 'catalog') };
    }
    const own = await campusModel.findById(req.library.campusId);
    if (!own || !own.isActive) return { fail: (res) => forbidden(res, 'Library access denied') };
    return { campus: own };
  }
  if (isBlank(rawCampusId)) {
    return required ? { fail: (res) => badRequest(res, 'Campus is required') } : { campus: null };
  }
  if (typeof rawCampusId !== 'string' || !mongoose.isValidObjectId(rawCampusId)) {
    return { fail: (res) => badRequest(res, 'Invalid campus') };
  }
  const campus = await campusModel.findById(rawCampusId);
  if (!campus || !campus.isActive) return { fail: (res) => notFound(res, 'Campus not found') };
  return { campus };
}

// Loads a raw book by :id with strict campus scoping. Returns the doc or null (response already sent).
async function loadBook(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { notFound(res, 'Book not found'); return null; }
  const book = await bookModel.findRawById(id);
  if (!book) { notFound(res, 'Book not found'); return null; }
  if (!assertCampusAccess(req, book.campusId)) { deny(req, res, 'book'); return null; }
  return book;
}

async function loadCopy(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { notFound(res, 'Copy not found'); return null; }
  const copy = await bookCopyModel.findById(id);
  if (!copy) { notFound(res, 'Copy not found'); return null; }
  if (!assertCampusAccess(req, copy.campusId)) { deny(req, res, 'copy'); return null; }
  return copy;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const seqRange = (code, seqs) =>
  seqs.length === 1 ? format(code, seqs[0]) : `${format(code, seqs[0])} – ${format(code, seqs[seqs.length - 1])}`;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function listBooks(req, res) {
  const { q, status, category, shelf, campusId } = req.query;
  for (const [k, v] of Object.entries({ q, status, category, shelf, campusId })) {
    if (v !== undefined && typeof v !== 'string') return badRequest(res, `Invalid ${k}`);
  }
  if (status && !COPY_STATUSES.includes(status)) return badRequest(res, 'Invalid status');

  let scope;
  if (req.library.isAdmin) {
    if (campusId) {
      if (!mongoose.isValidObjectId(campusId)) return badRequest(res, 'Invalid campus');
      scope = { campusId: new ObjectId(campusId) };
    } else scope = {};
  } else {
    if (campusId && !assertCampusAccess(req, campusId)) return deny(req, res, 'catalog');
    scope = campusFilter(req);
  }

  const page = Math.min(10000, Math.max(1, parseInt(req.query.page, 10) || 1));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const data = await bookModel.search({
    scope, q: str(q).slice(0, 100), status, category: str(category), shelf: str(shelf), page, limit,
  });
  return ok(res, data);
}

async function similarBooks(req, res) {
  const { title, author, campusId } = req.query;
  if (typeof title !== 'string' || !title.trim()) return badRequest(res, 'Title is required');
  if (author !== undefined && typeof author !== 'string') return badRequest(res, 'Invalid author');
  const r = await resolveCampus(req, campusId, { required: true });
  if (r.fail) return r.fail(res);
  const items = await bookModel.findSimilar({
    campusId: new ObjectId(r.campus.id), title: title.trim(), matchKey: matchKey(title, author),
  });
  return ok(res, items);
}

async function getBook(req, res) {
  const raw = await loadBook(req, res);
  if (!raw) return;
  const book = await bookModel.findDetailedById(raw._id);
  const [history, settings] = await Promise.all([
    bookModel.history(book.id, book.copies.map((c) => c.id)),
    librarySettingsModel.get(),
  ]);
  const loans = await loanModel.findViewsByBook(raw._id, { settings });
  return ok(res, { book, history, loans });
}

// ---------------------------------------------------------------------------
// Writes — books / copies
// ---------------------------------------------------------------------------

async function createBook(req, res) {
  const body = req.body || {};
  const r = await resolveCampus(req, body.campusId);
  if (r.fail) return r.fail(res);
  const { campus } = r;

  const { errors, value } = validateBookFields(body);
  const c = cleanCopies(body.copies);
  if (c.error) errors.push(c.error);
  const shelf = cleanText(body.shelfLocation, 'shelfLocation');
  if (shelf.error) errors.push(shelf.error);
  const copyRemarks = cleanText(body.copyRemarks, 'remarks');
  if (copyRemarks.error) errors.push(copyRemarks.error);
  if (errors.length) return badRequest(res, errors[0]);
  value.category = canonicalizer(campus.categories)(value.category);
  shelf.value = canonicalizer(campus.shelfLocations)(shelf.value);
  const capErr = listCapacityError(campus.categories, [value.category], 'Category')
    || listCapacityError(campus.shelfLocations, [shelf.value], 'Shelf');
  if (capErr) return badRequest(res, capErr);

  const campusId = new ObjectId(campus.id);
  const seqs = await reserve(campusId, c.value);
  const bookId = new ObjectId();
  const bookDoc = { _id: bookId, campusId, ...value, matchKey: matchKey(value.title, value.author) };
  const copyDocs = seqs.map((seq) => ({
    campusId, bookId, seq, catalogNumber: format(campus.code, seq), status: 'AVAILABLE',
    shelfLocation: shelf.value, remarks: copyRemarks.value,
  }));
  await bookModel.insertCatalog({
    campusId, books: [bookDoc], copies: copyDocs,
    categories: value.category ? [value.category] : [],
    shelfLocations: shelf.value ? [shelf.value] : [],
  });

  await logAudit(req, 'CREATE', 'Book', String(bookId),
    `Added book "${value.title}"${value.author ? ` by ${value.author}` : ''} with ${seqs.length} cop${seqs.length === 1 ? 'y' : 'ies'} (${seqRange(campus.code, seqs)}) to campus ${campus.name}`);
  const book = await bookModel.findDetailedById(bookId);
  return created(res, { book, copies: book.copies.filter((cp) => seqs.includes(cp.seq)) });
}

async function addCopies(req, res) {
  const raw = await loadBook(req, res);
  if (!raw) return;
  const body = req.body || {};
  const n = cleanCopies(body.count, { label: 'Count', required: true });
  if (n.error) return badRequest(res, n.error);
  const shelf = cleanText(body.shelfLocation, 'shelfLocation');
  if (shelf.error) return badRequest(res, shelf.error);
  const remarks = cleanText(body.remarks, 'remarks');
  if (remarks.error) return badRequest(res, remarks.error);

  const campus = await campusModel.findById(raw.campusId);
  if (!campus) return notFound(res, 'Campus not found');
  shelf.value = canonicalizer(campus.shelfLocations)(shelf.value);
  const capErr = listCapacityError(campus.shelfLocations, [shelf.value], 'Shelf');
  if (capErr) return badRequest(res, capErr);
  const campusId = new ObjectId(campus.id);
  const seqs = await reserve(campusId, n.value);
  const copyDocs = seqs.map((seq) => ({
    campusId, bookId: raw._id, seq, catalogNumber: format(campus.code, seq), status: 'AVAILABLE',
    shelfLocation: shelf.value, remarks: remarks.value,
  }));
  await bookModel.insertCatalog({
    campusId, copies: copyDocs, shelfLocations: shelf.value ? [shelf.value] : [],
  });

  await logAudit(req, 'UPDATE', 'Book', String(raw._id),
    `Added ${seqs.length} cop${seqs.length === 1 ? 'y' : 'ies'} (${seqRange(campus.code, seqs)}) to "${raw.title}"`);
  const book = await bookModel.findDetailedById(raw._id);
  return created(res, { book, copies: book.copies.filter((cp) => seqs.includes(cp.seq)) });
}

async function updateBook(req, res) {
  const raw = await loadBook(req, res);
  if (!raw) return;
  const body = req.body || {};
  const input = {};
  for (const f of EDITABLE_BOOK_FIELDS) if (body[f] !== undefined) input[f] = body[f];
  if (Object.keys(input).length === 0) return badRequest(res, 'No fields to update');

  const { errors, value } = validateBookFields(input, { partial: true });
  if (errors.length) return badRequest(res, errors[0]);
  if (value.category) {
    const campus = await campusModel.findById(raw.campusId);
    if (!campus) return notFound(res, 'Campus not found');
    value.category = canonicalizer(campus.categories)(value.category);
    const capErr = listCapacityError(campus.categories, [value.category], 'Category');
    if (capErr) return badRequest(res, capErr);
  }

  const changes = [];
  const data = {};
  for (const [f, v] of Object.entries(value)) {
    const old = raw[f] ?? (f === 'year' || f === 'price' ? null : '');
    if (old === v) continue;
    data[f] = v;
    const show = (x) => (x === null || x === '' ? '(none)' : x);
    changes.push(`${f}: "${show(old)}" → "${show(v)}"`);
  }
  if (Object.keys(data).length === 0) {
    return ok(res, await bookModel.findDetailedById(raw._id));
  }
  if (data.title !== undefined || data.author !== undefined) {
    data.matchKey = matchKey(data.title ?? raw.title, data.author ?? raw.author);
  }

  await bookModel.updateFields(raw._id, data);
  if (data.category) {
    await campusModel.addToLists(raw.campusId, { categories: [data.category] });
  }
  await logAudit(req, 'UPDATE', 'Book', String(raw._id), `Updated "${raw.title}" — ${changes.join('; ')}`);
  return ok(res, await bookModel.findDetailedById(raw._id));
}

async function updateCopy(req, res) {
  const raw = await loadCopy(req, res);
  if (!raw) return;
  const body = req.body || {};
  const data = {};
  const changes = [];
  const show = (x) => (x ? x : '(none)');
  let shelfCampus = null;
  for (const [f, label] of [['shelfLocation', 'shelfLocation'], ['remarks', 'remarks']]) {
    if (body[f] === undefined) continue;
    const r = cleanText(body[f], f);
    if (r.error) return badRequest(res, r.error);
    if (f === 'shelfLocation' && r.value) {
      shelfCampus = await campusModel.findById(raw.campusId);
      if (!shelfCampus) return notFound(res, 'Campus not found');
      r.value = canonicalizer(shelfCampus.shelfLocations)(r.value);
      const capErr = listCapacityError(shelfCampus.shelfLocations, [r.value], 'Shelf');
      if (capErr) return badRequest(res, capErr);
    }
    if ((raw[f] || '') !== r.value) {
      data[f] = r.value;
      changes.push(`${label}: "${show(raw[f])}" → "${show(r.value)}"`);
    }
  }
  if (body.shelfLocation === undefined && body.remarks === undefined) return badRequest(res, 'No fields to update');
  if (Object.keys(data).length === 0) return ok(res, await bookCopyModel.findShapedById(raw._id));

  await bookCopyModel.updateFields(raw._id, data);
  if (data.shelfLocation) {
    await campusModel.addToLists(raw.campusId, { shelfLocations: [data.shelfLocation] });
  }
  await logAudit(req, 'UPDATE', 'BookCopy', String(raw._id), `Updated ${raw.catalogNumber} — ${changes.join('; ')}`);
  return ok(res, await bookCopyModel.findShapedById(raw._id));
}

async function withdrawCopy(req, res) {
  const raw = await loadCopy(req, res);
  if (!raw) return;
  const reason = str(req.body?.reason);
  if (!reason) return badRequest(res, 'Reason is required');
  if (reason.length > 300) return badRequest(res, 'Reason must be 300 characters or fewer');

  const done = await bookCopyModel.withdraw(raw._id, { userId: req.user.id, reason });
  if (!done) return badRequest(res, 'Only available or damaged copies can be withdrawn');
  await logAudit(req, 'UPDATE', 'BookCopy', String(raw._id),
    `Withdrew ${raw.catalogNumber} (was ${done.previous}) — reason: ${reason}`);
  return ok(res, await bookCopyModel.findShapedById(raw._id));
}

async function reinstateCopy(req, res) {
  if (!req.library.isAdmin) {
    logError(req, 403, `Non-admin attempted to reinstate a copy — ${req.method} ${req.originalUrl}`);
    return forbidden(res, 'Only an administrator can reinstate a withdrawn copy');
  }
  const raw = await loadCopy(req, res);
  if (!raw) return;
  const done = await bookCopyModel.reinstate(raw._id);
  if (!done) return badRequest(res, 'Only withdrawn copies can be reinstated');
  await logAudit(req, 'UPDATE', 'BookCopy', String(raw._id),
    `Reinstated ${raw.catalogNumber} (withdrawn → ${done.restored})`);
  return ok(res, await bookCopyModel.findShapedById(raw._id));
}

// Phase 5: LOST -> AVAILABLE. Charges are never touched.
async function markFound(req, res) {
  const raw = await loadCopy(req, res);
  if (!raw) return;
  const note = cleanOptionalText(req.body?.note, 'Note', 500);
  if (note.error) return badRequest(res, note.error);

  let out;
  try {
    out = await circulationService.markCopyFound({ copyId: raw._id, userId: req.user.id });
  } catch (err) {
    if (err?.name === 'CirculationError') return badRequest(res, err.message);
    throw err;
  }

  // ---- committed: from here on NEVER return an error ----
  let book = null;
  let student = null;
  try {
    book = await Book.findById(raw.bookId).select('title').lean();
    if (out.loan) student = await Student.findById(out.loan.studentId).select('fullName regNumber').lean();
  } catch (err) { console.error('[catalog] post-found lookups', err.message); }
  const lostOn = out.before.lostAt ? fine.istDate(out.before.lostAt) : null;
  const was = student
    ? `lost by ${student.regNumber}${lostOn ? ` on ${lostOn}` : ''}`
    : `lost${out.before.lostSource === 'STOCK_CHECK' ? ' in a stock check' : ''}${lostOn ? ` on ${lostOn}` : ''}`;
  await logAudit(req, 'UPDATE', 'BookCopy', String(raw._id),
    `Marked found ${raw.catalogNumber} "${book?.title || ''}" (was ${was}) — charges unchanged`
    + (note.value ? ` — note: ${note.value}` : ''));

  try {
    const copy = await bookCopyModel.findShapedById(raw._id);
    let loanView = null;
    if (out.loan) [loanView] = await loanModel.shapeMany([out.loan], { settings: await librarySettingsModel.get() });
    return ok(res, { ...copy, loan: loanView });
  } catch (err) {
    console.error('[catalog] post-found response build', err);
    return ok(res, { id: String(raw._id), catalogNumber: raw.catalogNumber, status: out.copy.status, loan: null },
      'Marked found — refresh to see the copy');
  }
}

// Phase 5: DAMAGED -> AVAILABLE.
async function markRepaired(req, res) {
  const raw = await loadCopy(req, res);
  if (!raw) return;
  const note = cleanOptionalText(req.body?.note, 'Note', 500);
  if (note.error) return badRequest(res, note.error);
  try {
    await circulationService.markCopyRepaired({ copyId: raw._id, userId: req.user.id });
  } catch (err) {
    if (err?.name === 'CirculationError') return badRequest(res, err.message);
    throw err;
  }
  let title = '';
  try { title = (await Book.findById(raw.bookId).select('title').lean())?.title || ''; } catch (err) { console.error('[catalog] post-repair lookup', err.message); }
  await logAudit(req, 'UPDATE', 'BookCopy', String(raw._id),
    `Marked repaired ${raw.catalogNumber} "${title}"` + (note.value ? ` — note: ${note.value}` : ''));
  return ok(res, await bookCopyModel.findShapedById(raw._id));
}

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

function parseRows(body) {
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length < 1) return { error: 'rows must be a non-empty array' };
  if (rows.length > MAX_BULK_ROWS) return { error: `A maximum of ${MAX_BULK_ROWS} rows can be processed at once` };
  return { rows };
}

// Per-row resolution → Map<index, { mode:'new' } | { mode:'existing', bookId } | { error }>.
async function parseResolutions(campusId, rows) {
  const out = new Map();
  const ids = [];
  rows.forEach((row, i) => {
    const r = row && row.resolution;
    if (r === undefined || r === null) { out.set(i, { mode: 'new' }); return; }
    if (typeof r !== 'object' || (r.mode !== 'new' && r.mode !== 'existing')) {
      out.set(i, { error: 'Invalid resolution' }); return;
    }
    if (r.mode === 'new') { out.set(i, { mode: 'new' }); return; }
    if (typeof r.bookId !== 'string' || !mongoose.isValidObjectId(r.bookId)) {
      out.set(i, { error: 'Invalid existing book selected' }); return;
    }
    out.set(i, { mode: 'existing', bookId: r.bookId });
    ids.push(r.bookId);
  });
  const found = await bookModel.existingInCampus(campusId, [...new Set(ids)]);
  for (const [i, r] of out) {
    if (r.mode === 'existing' && !found.has(r.bookId)) {
      out.set(i, { error: 'Selected existing book was not found in this campus' });
    }
  }
  return out;
}

// Builds the public BulkValidation from the pure result + DB duplicates.
async function buildValidation(campus, rows, { resolutions } = {}) {
  const v = validateBulkRows(rows, campus);
  if (resolutions) {
    v.rows.forEach((r, i) => {
      const res = resolutions.get(i);
      if (res?.error) r.errors.push(res.error);
    });
  }
  const dupMap = await bookModel.duplicatesByMatchKeys(
    new ObjectId(campus.id), v.rows.map((r) => r.matchKey).filter(Boolean),
  );
  return {
    validation: {
      valid: v.errors.length === 0 && v.rows.every((r) => r.errors.length === 0),
      totalRows: v.totalRows,
      totalCopies: v.totalCopies,
      rows: v.rows.map((r) => ({
        rowNumber: r.rowNumber,
        errors: r.errors,
        duplicates: r.matchKey ? dupMap.get(r.matchKey) || [] : [],
        duplicateInFile: r.duplicateInFile,
      })),
      newCategories: v.newCategories,
      newShelves: v.newShelves,
      errors: v.errors,
    },
    pure: v,
  };
}

async function bulkValidate(req, res) {
  const body = req.body || {};
  const parsed = parseRows(body);
  if (parsed.error) return badRequest(res, parsed.error);
  const r = await resolveCampus(req, body.campusId);
  if (r.fail) return r.fail(res);

  const { validation } = await buildValidation(r.campus, parsed.rows);
  if (validation.errors.length) return res.status(400).json({ success: false, message: validation.errors[0], data: validation });
  if (validation.totalCopies > MAX_BULK_COPIES) {
    return badRequest(res, `Too many copies in one import (maximum ${MAX_BULK_COPIES})`);
  }
  return ok(res, validation);
}

async function bulkImport(req, res) {
  const body = req.body || {};
  const parsed = parseRows(body);
  if (parsed.error) return badRequest(res, parsed.error);
  const r = await resolveCampus(req, body.campusId);
  if (r.fail) return r.fail(res);
  const { campus } = r;
  const campusId = new ObjectId(campus.id);

  const resolutions = await parseResolutions(campusId, parsed.rows);
  const { validation, pure } = await buildValidation(campus, parsed.rows, { resolutions });
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: validation.errors[0] || 'Some rows have errors — fix them and try again',
      data: validation,
    });
  }
  if (pure.totalCopies > MAX_BULK_COPIES) {
    return badRequest(res, `Too many copies in one import (maximum ${MAX_BULK_COPIES})`);
  }

  // Reuse the campus list's spelling (and first-seen spelling within the file).
  const canonCat = canonicalizer(campus.categories);
  const canonShelf = canonicalizer(campus.shelfLocations);
  pure.rows.forEach((row, i) => {
    if (resolutions.get(i).mode === 'new') row.clean.category = canonCat(row.clean.category);
    row.clean.shelfLocation = canonShelf(row.clean.shelfLocation);
  });

  // Reserve every catalog number up front (one $inc); gaps on failure are acceptable.
  const seqs = await reserve(campusId, pure.totalCopies);
  let cursor = 0;

  const bookDocs = [];
  const copyDocs = [];
  const titleByBookId = new Map();
  const perBook = new Map();                // bookId -> { title, isNew, first, last, count }
  const categories = [];
  const shelves = [];

  pure.rows.forEach((row, i) => {
    const res_ = resolutions.get(i);
    const c = row.clean;
    let bookId;
    let title;
    if (res_.mode === 'existing') {
      bookId = new ObjectId(res_.bookId);
    } else {
      bookId = new ObjectId();
      title = c.title;
      bookDocs.push({
        _id: bookId, campusId, title: c.title, author: c.author, category: c.category,
        publisher: c.publisher, edition: c.edition, isbn: c.isbn, remarks: c.remarks,
        year: c.year, price: c.price, matchKey: row.matchKey,
      });
      if (c.category) categories.push(c.category);
    }
    if (c.shelfLocation) shelves.push(c.shelfLocation);

    const mine = seqs.slice(cursor, cursor + c.copies);
    cursor += c.copies;
    for (const seq of mine) {
      copyDocs.push({
        campusId, bookId, seq, catalogNumber: format(campus.code, seq), status: 'AVAILABLE',
        shelfLocation: c.shelfLocation, remarks: '',
      });
    }
    const key = String(bookId);
    if (title !== undefined) titleByBookId.set(key, title);
    const prev = perBook.get(key);
    if (prev) { prev.count += mine.length; prev.last = mine[mine.length - 1]; }
    else perBook.set(key, { isNew: res_.mode === 'new', first: mine[0], last: mine[mine.length - 1], count: mine.length });
  });

  // Titles of existing books (needed for audit text) — one query.
  const existingIds = [...perBook].filter(([, v]) => !v.isNew).map(([k]) => k);
  const existingTitles = await bookModel.existingInCampus(campusId, existingIds);
  for (const [k, t] of existingTitles) titleByBookId.set(k, t);

  const result = await bookModel.insertCatalog({
    campusId, books: bookDocs, copies: copyDocs, categories, shelfLocations: shelves,
  });

  const entries = [];
  for (const [bookId, info] of perBook) {
    const t = titleByBookId.get(bookId) || '';
    const range = info.count === 1 ? format(campus.code, info.first) : `${format(campus.code, info.first)} – ${format(campus.code, info.last)}`;
    entries.push(info.isNew
      ? { action: 'CREATE', entity: 'Book', entityId: bookId, description: `Bulk import: added book "${t}" with ${info.count} cop${info.count === 1 ? 'y' : 'ies'} (${range})` }
      : { action: 'UPDATE', entity: 'Book', entityId: bookId, description: `Bulk import: added ${info.count} cop${info.count === 1 ? 'y' : 'ies'} (${range}) to "${t}"` });
  }
  const addedToExisting = existingIds.length;
  entries.push({
    action: 'UPDATE', entity: 'Campus', entityId: campus.id,
    description: `Bulk import into campus ${campus.name}: ${bookDocs.length} new book(s), ${addedToExisting} existing book(s) got copies, ${copyDocs.length} cop${copyDocs.length === 1 ? 'y' : 'ies'} total`,
  });
  await logAuditMany(req, entries);

  const copies = result.createdCopies
    .map((d) => ({ ...bookCopyModel.shape(d.toObject()), title: titleByBookId.get(String(d.bookId)) || '' }))
    .sort((a, b) => a.seq - b.seq);
  return created(res, {
    createdBooks: bookDocs.length,
    addedToExisting,
    copies,
    addedCategories: result.addedCategories,
    addedShelves: result.addedShelves,
  });
}

module.exports = {
  listBooks, similarBooks, getBook, createBook, addCopies, updateBook, updateCopy,
  withdrawCopy, reinstateCopy, markFound, markRepaired, bulkValidate, bulkImport,
  // exported for review/testing
  buildValidation,
};
