const { Loan, BookCopy, Book, Student, Batch, User, normalize, containsInsensitive } = require('./schemas');
const campusModel = require('./campusModel');
const fine = require('../services/fineService');
const finePeriodModel = require('./finePeriodModel');

const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];

const findById = (id, { session } = {}) => Loan.findById(id).session(session || null).lean();

// The OPEN loan of a copy (at most one, guaranteed by the partial unique index).
const findOpenByCopy = (copyId, { session } = {}) =>
  Loan.findOne({ copyId, status: 'OPEN' }).session(session || null).lean();

const findOpenByStudent = (studentId, { session } = {}) =>
  Loan.find({ studentId, status: 'OPEN' }).session(session || null).lean();

const hasAnyAtCampus = (studentId, campusId) => Loan.exists({ studentId, campusId }).then(Boolean);

// LoanView[] for raw lean loans, with copy / book / student(+batch) / users / campus
// stitched in two rounds of batched queries (never per row).
//   settings: LibrarySettings (maxRenewals drives canRenew)
//   periods: optional Map<campusId, {from,to}[]> of active no-fine periods (loaded here, once for
//            all OPEN loans' campuses, when not supplied). Closed loans use their frozen values.
const shapeMany = async (docs, { settings, now = new Date(), periods } = {}) => {
  if (docs.length === 0) return [];
  const periodsByCampus = periods
    || await finePeriodModel.loadActive(docs.filter((d) => d.status === 'OPEN').map((d) => d.campusId));
  const [copies, books, students, users, campuses] = await Promise.all([
    BookCopy.find({ _id: { $in: uniq(docs.map((d) => d.copyId)) } }).select('catalogNumber status').lean(),
    Book.find({ _id: { $in: uniq(docs.map((d) => d.bookId)) } }).select('title author price').lean(),
    Student.find({ _id: { $in: uniq(docs.map((d) => d.studentId)) } }).select('fullName regNumber batchId').lean(),
    User.find({ _id: { $in: uniq(docs.flatMap((d) => [d.issuedBy, d.returnedBy, d.lostBy, ...(d.renewals || []).map((r) => r.by)])) } })
      .select('name').lean(),
    campusModel.summariesByIds(docs.map((d) => d.campusId)),
  ]);
  const batches = await Batch.find({ _id: { $in: uniq(students.map((s) => s.batchId)) } }).select('name').lean();

  const copyById = new Map(copies.map((c) => [String(c._id), c]));
  const bookById = new Map(books.map((b) => [String(b._id), b]));
  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const batchById = new Map(batches.map((b) => [String(b._id), { id: String(b._id), name: b.name }]));
  const person = (id) => (id ? { id: String(id), name: userName.get(String(id)) || 'Unknown' } : null);

  return docs.map((d) => {
    const n = normalize(d);
    const copy = copyById.get(String(d.copyId));
    const book = bookById.get(String(d.bookId));
    const st = studentById.get(String(d.studentId));
    const closed = d.status !== 'OPEN';
    const live = closed ? null : fine.fineBreakdown(d, now, periodsByCampus.get(String(d.campusId)) || []);
    const renew = settings ? fine.renewalCheck(d, settings, now) : { allowed: false, reason: null };
    return {
      id: n.id,
      campusId: n.campusId,
      campus: campuses.get(String(d.campusId)) || null,
      copy: { id: n.copyId, catalogNumber: copy?.catalogNumber || '', status: copy?.status || '' },
      book: { id: n.bookId, title: book?.title || '', author: book?.author || '', price: book?.price ?? null },
      student: {
        id: n.studentId, fullName: st?.fullName || '', regNumber: st?.regNumber || '',
        batch: st ? batchById.get(String(st.batchId)) || null : null,
      },
      issuedAt: n.issuedAt,
      issuedBy: person(d.issuedBy),
      dueDate: n.dueDate,
      renewCount: n.renewCount || 0,
      renewals: (d.renewals || []).map((r) => ({
        at: r.at, by: person(r.by), previousDueDate: r.previousDueDate, newDueDate: r.newDueDate,
      })),
      status: n.status,
      returnedAt: n.returnedAt || null,
      returnedBy: person(d.returnedBy),
      lostAt: n.lostAt || null,
      lostBy: person(d.lostBy),
      foundAt: n.foundAt || null,
      condition: n.condition || null,
      daysLate: closed ? (d.fineDays ?? 0) : live.daysLate,
      waivedDays: closed ? (d.fineWaivedDays ?? 0) : live.waivedDays,
      lateFine: closed ? (d.fineAmount ?? 0) : live.lateFine,
      isOverdue: fine.isOverdue(d, now),
      canRenew: renew.allowed,
      renewBlockedReason: renew.allowed ? null : renew.reason,
      backdated: d.backdated ? normalize(d.backdated) : null,
    };
  });
};

// Sets `copy.loan` on every (already shaped) copy: null unless ISSUED with an OPEN loan.
// At most 2 batched queries, none when no copy is issued. Mutates and returns the array.
const attachLoanInfo = async (copies, now = new Date()) => {
  const issued = copies.filter((c) => c.status === 'ISSUED');
  for (const c of copies) c.loan = null;
  if (issued.length === 0) return copies;
  const loans = await Loan.find({ copyId: { $in: issued.map((c) => c.id) }, status: 'OPEN' })
    .select('copyId dueDate studentId campusId finePerDay').lean();
  const periods = await finePeriodModel.loadActive(loans.map((l) => l.campusId));
  const students = await Student.find({ _id: { $in: uniq(loans.map((l) => l.studentId)) } })
    .select('fullName regNumber').lean();
  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const byCopy = new Map(loans.map((l) => [String(l.copyId), l]));
  for (const c of issued) {
    const l = byCopy.get(String(c.id));
    if (!l) continue;
    const st = studentById.get(String(l.studentId));
    const bd = fine.fineBreakdown({ dueDate: l.dueDate, finePerDay: l.finePerDay }, now, periods.get(String(l.campusId)) || []);
    c.loan = {
      id: String(l._id),
      dueDate: l.dueDate,
      isOverdue: fine.isOverdue({ status: 'OPEN', dueDate: l.dueDate }, now),
      daysLate: bd.daysLate,
      waivedDays: bd.waivedDays,
      lateFine: bd.lateFine,
      student: { id: String(l.studentId), fullName: st?.fullName || '', regNumber: st?.regNumber || '' },
    };
  }
  return copies;
};

// Newest-first loans of a book (max 200) as LoanViews.
const findViewsByBook = async (bookId, { settings, now } = {}) => {
  const docs = await Loan.find({ bookId }).sort({ issuedAt: -1, _id: -1 }).limit(200).lean();
  return shapeMany(docs, { settings, now });
};

// Paginated OPEN loans by due-date view. `scope` = {} | { campusId }.
const listOpen = async ({ scope, view, q, page, limit, now = new Date() }) => {
  const today = fine.istDate(now);
  const filter = { ...scope, status: 'OPEN' };
  if (view === 'overdue') filter.dueDate = { $lt: today };
  else if (view === 'dueToday') filter.dueDate = today;
  else if (view === 'dueSoon') filter.dueDate = { $gt: today, $lte: fine.addDays(today, 2) };

  // daysLate desc == dueDate asc (daysLate = today - dueDate), so one sort serves every view.
  const sort = { dueDate: 1, issuedAt: 1, _id: 1 };

  if (q) {
    // Search INSIDE the already-scoped loan set (scope + view), joining student and copy, so
    // no arbitrary pre-selection of students can drop matches. Then paginate.
    const rx = containsInsensitive(q);
    const [res] = await Loan.aggregate([
      { $match: filter },
      { $lookup: { from: Student.collection.name, localField: 'studentId', foreignField: '_id', as: '_st' } },
      { $lookup: { from: BookCopy.collection.name, localField: 'copyId', foreignField: '_id', as: '_cp' } },
      { $match: { $or: [
        { '_st.regNumber': rx }, { '_st.fullName': rx }, { '_cp.catalogNumber': rx },
      ] } },
      { $sort: sort },
      { $project: { _st: 0, _cp: 0 } },
      { $facet: {
        meta: [{ $count: 'total' }],
        docs: [{ $skip: (page - 1) * limit }, { $limit: limit }],
      } },
    ]);
    return { docs: res.docs, total: res.meta[0]?.total || 0 };
  }

  const [total, docs] = await Promise.all([
    Loan.countDocuments(filter),
    Loan.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return { docs, total };
};

const findByStudent = (studentId, scope = {}, limit = 500) =>
  Loan.find({ studentId, ...scope }).sort({ issuedAt: -1, _id: -1 }).limit(limit).lean();

module.exports = {
  findById, findOpenByCopy, findOpenByStudent, hasAnyAtCampus, shapeMany, attachLoanInfo,
  findViewsByBook, listOpen, findByStudent,
};
