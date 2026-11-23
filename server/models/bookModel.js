const { mongoose } = require('../utils/db');
const { Book, BookCopy, AuditLog, normalize, containsInsensitive } = require('./schemas');
const campusModel = require('./campusModel');
const bookCopyModel = require('./bookCopyModel');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactInsensitive = (s) => ({ $regex: `^${escapeRegex(s)}$`, $options: 'i' });
const TITLE_COLLATION = { locale: 'en', strength: 2 };

const shapeBase = (b) => {
  const n = normalize(b);
  return {
    ...n,
    author: n.author || '', category: n.category || '', publisher: n.publisher || '',
    edition: n.edition || '', isbn: n.isbn || '', remarks: n.remarks || '',
    year: n.year ?? null, price: n.price ?? null, matchKey: n.matchKey || '',
  };
};

// Attach campus summary, copies (sorted by seq) and copyCounts using 3 batched queries total.
const decorate = async (docs) => {
  if (docs.length === 0) return [];
  const books = docs.map(shapeBase);
  const [campuses, copiesByBook] = await Promise.all([
    campusModel.summariesByIds(books.map((b) => b.campusId)),
    bookCopyModel.findByBookIds(books.map((b) => b.id)),
  ]);
  return books.map((b) => {
    const copies = copiesByBook.get(b.id) || [];
    return {
      ...b,
      campus: campuses.get(String(b.campusId)) || undefined,
      copies,
      copyCounts: bookCopyModel.countsFor(copies),
    };
  });
};

const findRawById = (id) => Book.findById(id).lean();

const findDetailedById = async (id) => {
  const doc = await Book.findById(id).lean();
  return doc ? (await decorate([doc]))[0] : null;
};

// Catalog-number search terms. Returns copy-level $or clauses for the typed query.
function catalogClauses(q) {
  const upper = q.trim().toUpperCase();
  const clauses = [];
  if (/^\d+$/.test(upper)) {
    clauses.push({ seq: parseInt(upper, 10) });
  } else if (/^[A-Z0-9]{2,6}-?\d+$/.test(upper)) {
    clauses.push({ catalogNumber: { $regex: `^${escapeRegex(upper)}` } });
  }
  return clauses;
}

// Paginated search. `scope` is {} (admin, all campuses) or { campusId }.
const search = async ({ scope, q, status, category, shelf, page, limit }) => {
  const and = [{ ...scope }];

  // Copy-level constraints (status/shelf must hold on the same copy).
  const copyFilter = { ...scope };
  let copyConstrained = false;
  if (status) { copyFilter.status = status; copyConstrained = true; }
  if (shelf) { copyFilter.shelfLocation = exactInsensitive(shelf); copyConstrained = true; }
  if (copyConstrained) {
    const ids = await bookCopyModel.distinctBookIds(copyFilter);
    and.push({ _id: { $in: ids } });
  }

  if (category) and.push({ category: exactInsensitive(category) });

  if (q && q.trim()) {
    const term = q.trim();
    const rx = containsInsensitive(term);
    const copyOr = [{ shelfLocation: rx }, ...catalogClauses(term)];
    const copyIds = await bookCopyModel.distinctBookIds({ ...scope, $or: copyOr });
    and.push({
      $or: [
        { title: rx }, { author: rx }, { category: rx }, { isbn: rx },
        ...(copyIds.length ? [{ _id: { $in: copyIds } }] : []),
      ],
    });
  }

  const filter = and.length === 1 ? and[0] : { $and: and };
  const [total, docs] = await Promise.all([
    Book.countDocuments(filter),
    Book.find(filter).collation(TITLE_COLLATION).sort({ title: 1, _id: 1 })
      .skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return { items: await decorate(docs), total, page, limit };
};

// Same-campus books whose matchKey equals, or whose title contains the given title.
const findSimilar = async ({ campusId, title, matchKey }) => {
  const docs = await Book.find({
    campusId,
    $or: [{ matchKey }, { title: containsInsensitive(title) }],
  }).collation(TITLE_COLLATION).sort({ title: 1 }).limit(10).lean();
  return decorate(docs);
};

// Existing books in the campus having any of these matchKeys → Map<matchKey, [{id,title,author,copyCount}]>.
const duplicatesByMatchKeys = async (campusId, keys) => {
  const map = new Map();
  const unique = [...new Set(keys)];
  if (unique.length === 0) return map;
  const books = await Book.find({ campusId, matchKey: { $in: unique } }).select('title author matchKey').lean();
  if (books.length === 0) return map;
  const counts = await BookCopy.aggregate([
    { $match: { bookId: { $in: books.map((b) => b._id) } } },
    { $group: { _id: '$bookId', n: { $sum: 1 } } },
  ]);
  const countById = new Map(counts.map((c) => [String(c._id), c.n]));
  for (const b of books) {
    if (!map.has(b.matchKey)) map.set(b.matchKey, []);
    map.get(b.matchKey).push({
      id: String(b._id), title: b.title, author: b.author || '', copyCount: countById.get(String(b._id)) || 0,
    });
  }
  return map;
};

// Subset of the given ids that are real books of this campus → Map<id, title>.
const existingInCampus = async (campusId, ids) => {
  if (ids.length === 0) return new Map();
  const docs = await Book.find({ campusId, _id: { $in: ids } }).select('title').lean();
  return new Map(docs.map((d) => [String(d._id), d.title]));
};

// Single transactional write used by add-book, add-copies and bulk import.
// books/copies are plain insert docs (ObjectIds already assigned); campus category/shelf
// additions ride in the same transaction. Returns created docs + the list additions.
const insertCatalog = async ({ campusId, books = [], copies = [], categories = [], shelfLocations = [] }) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const createdBooks = books.length ? await Book.insertMany(books, { session }) : [];
      const createdCopies = copies.length ? await BookCopy.insertMany(copies, { session }) : [];
      const lists = await campusModel.addToLists(campusId, { categories, shelfLocations }, { session });
      result = { createdBooks, createdCopies, ...lists };
    });
  } finally {
    await session.endSession();
  }
  return result;
};

const updateFields = (id, data) =>
  Book.findByIdAndUpdate(id, { $set: data }, { new: true }).lean();

// Audit trail for a book + its copies, newest first.
const history = async (bookId, copyIds) => {
  const docs = await AuditLog.find({
    $or: [
      { entity: 'Book', entityId: String(bookId) },
      ...(copyIds.length ? [{ entity: 'BookCopy', entityId: { $in: copyIds.map(String) } }] : []),
    ],
  }).sort({ createdAt: -1 }).limit(200).lean();
  return docs.map((d) => {
    const n = normalize(d);
    return {
      id: n.id, action: n.action, entity: n.entity, entityId: n.entityId,
      description: n.description, userName: n.userName || '', userRole: n.userRole || '',
      createdAt: n.createdAt,
    };
  });
};

module.exports = {
  decorate, findRawById, findDetailedById, search, findSimilar, duplicatesByMatchKeys,
  existingInCampus, insertCatalog, updateFields, history,
};
