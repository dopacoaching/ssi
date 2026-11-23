// Library Phase 5: report definitions. Every report returns { columns, rows, totals } (rows may be
// longer than MAX_ROWS by one so the controller can flag truncation). Fines use the same rule
// (periods) as Phase 4 via fineService / finePendingService. No req/res here.
const {
  Loan, BookCopy, Book, Student, Batch, User, Charge, Payment, Waiver, Campus, WAIVER_STATUSES,
} = require('../models/schemas');
const campusModel = require('../models/campusModel');
const chargeModel = require('../models/chargeModel');
const waiverModel = require('../models/waiverModel');
const finePeriodModel = require('../models/finePeriodModel');
const finePending = require('./finePendingService');
const fine = require('./fineService');

const MAX_ROWS = 5000;
const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];
const sumBy = (rows, key) => fine.round2(rows.reduce((t, r) => t + (Number(r[key]) || 0), 0));
const col = (key, label, type = 'text') => ({ key, label, type });
const withCampus = (show, cols) => (show ? [col('campus', 'Campus'), ...cols] : cols);
const dateOf = (d) => (d ? fine.istDate(d) : null);
const istStart = (ymd) => new Date(`${ymd}T00:00:00+05:30`);
const istEndExclusive = (ymd) => new Date(`${fine.addDays(ymd, 1)}T00:00:00+05:30`);
const dateRange = (from, to) => ({ $gte: istStart(from), $lt: istEndExclusive(to) });

// ---------------------------------------------------------------------------
// Pure: default date ranges
// ---------------------------------------------------------------------------

// ymd minus n whole months, day clamped to the target month's length.
function monthsBefore(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const idx = y * 12 + (m - 1) - n;
  const ty = Math.floor(idx / 12);
  const tm = (idx % 12 + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const DEFAULT_RANGE = {
  'fine-collection': 'month', waivers: 'month', 'campus-comparison': 'month',
  'lost-damaged': 'year', 'most-borrowed': 'last12', 'student-borrowing': 'last12',
};

// { from, to } (YYYY-MM-DD, IST) a report uses when the caller gives none; { from: null, to: null }
// for reports without a date filter. `never-borrowed` reports its cutoff (`months` ago) as `from`.
function defaultRange(type, now = new Date(), { months = 12 } = {}) {
  const today = fine.istDate(now);
  const kind = DEFAULT_RANGE[type];
  if (kind === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (kind === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (kind === 'last12') return { from: monthsBefore(today, 12), to: today };
  if (type === 'never-borrowed') return { from: monthsBefore(today, months), to: today };
  return { from: null, to: null };
}

// ---------------------------------------------------------------------------
// Lookups (batched)
// ---------------------------------------------------------------------------

async function studentInfo(studentIds) {
  const students = await Student.find({ _id: { $in: uniq(studentIds) } }).select('fullName regNumber batchId isActive').lean();
  const batches = await Batch.find({ _id: { $in: uniq(students.map((s) => s.batchId)) } }).select('name campusId').lean();
  const batchById = new Map(batches.map((b) => [String(b._id), b]));
  return new Map(students.map((s) => [String(s._id), {
    fullName: s.fullName, regNumber: s.regNumber, isActive: !!s.isActive,
    batch: batchById.get(String(s.batchId))?.name || '',
  }]));
}

async function bookInfo(bookIds) {
  const books = await Book.find({ _id: { $in: uniq(bookIds) } }).select('title author category campusId').lean();
  return new Map(books.map((b) => [String(b._id), b]));
}

const campusNameMap = async (ids) => {
  const m = await campusModel.summariesByIds(ids);
  return new Map([...m.entries()].map(([k, v]) => [k, v.name]));
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

async function stockSummary({ scope, showCampus }) {
  const cat = { $trim: { input: { $ifNull: [{ $arrayElemAt: ['$_b.category', 0] }, ''] } } };
  const agg = await BookCopy.aggregate([
    { $match: scope },
    { $lookup: { from: Book.collection.name, localField: 'bookId', foreignField: '_id', as: '_b' } },
    { $addFields: { _cat: { $cond: [{ $eq: [cat, ''] }, 'Uncategorised', cat] } } },
    { $group: {
      _id: { campusId: '$campusId', category: '$_cat' },
      books: { $addToSet: '$bookId' },
      copies: { $sum: 1 },
      available: { $sum: { $cond: [{ $eq: ['$status', 'AVAILABLE'] }, 1, 0] } },
      issued: { $sum: { $cond: [{ $eq: ['$status', 'ISSUED'] }, 1, 0] } },
      lost: { $sum: { $cond: [{ $eq: ['$status', 'LOST'] }, 1, 0] } },
      damaged: { $sum: { $cond: [{ $eq: ['$status', 'DAMAGED'] }, 1, 0] } },
      withdrawn: { $sum: { $cond: [{ $eq: ['$status', 'WITHDRAWN'] }, 1, 0] } },
    } },
  ]);
  const names = showCampus ? await campusNameMap(agg.map((g) => g._id.campusId)) : new Map();
  const rows = agg.map((g) => ({
    ...(showCampus ? { campus: names.get(String(g._id.campusId)) || '' } : {}),
    category: g._id.category, titles: g.books.length, copies: g.copies, available: g.available,
    issued: g.issued, lost: g.lost, damaged: g.damaged, withdrawn: g.withdrawn,
  })).sort((a, b) => (a.campus || '').localeCompare(b.campus || '') || a.category.localeCompare(b.category));
  const keys = ['titles', 'copies', 'available', 'issued', 'lost', 'damaged', 'withdrawn'];
  return {
    columns: withCampus(showCampus, [col('category', 'Category'), ...keys.map((k) => col(k, k[0].toUpperCase() + k.slice(1), 'number'))]),
    rows,
    totals: Object.fromEntries(keys.map((k) => [k, rows.reduce((t, r) => t + r[k], 0)])),
  };
}

// Open loans -> rows with student / copy / book info.
async function openLoanRows(docs, { now, showCampus, extra }) {
  const [copies, books, students, names] = await Promise.all([
    BookCopy.find({ _id: { $in: uniq(docs.map((d) => d.copyId)) } }).select('catalogNumber').lean(),
    bookInfo(docs.map((d) => d.bookId)),
    studentInfo(docs.map((d) => d.studentId)),
    showCampus ? campusNameMap(docs.map((d) => d.campusId)) : new Map(),
  ]);
  const cn = new Map(copies.map((c) => [String(c._id), c.catalogNumber]));
  return docs.map((d) => {
    const st = students.get(String(d.studentId));
    return {
      ...(showCampus ? { campus: names.get(String(d.campusId)) || '' } : {}),
      catalogNumber: cn.get(String(d.copyId)) || '',
      title: books.get(String(d.bookId))?.title || '',
      student: st?.fullName || '', regNumber: st?.regNumber || '', batch: st?.batch || '',
      issuedAt: dateOf(d.issuedAt), dueDate: d.dueDate, daysLate: fine.daysLate(d, now),
      ...(extra ? extra(d) : {}),
    };
  });
}

const LOAN_COLS = [
  col('catalogNumber', 'Catalog no.'), col('title', 'Title'), col('student', 'Student'), col('regNumber', 'Reg number'),
  col('batch', 'Batch'), col('issuedAt', 'Issued', 'date'), col('dueDate', 'Due', 'date'), col('daysLate', 'Days late', 'number'),
];

async function issued({ scope, showCampus, now }) {
  const docs = await Loan.find({ ...scope, status: 'OPEN' }).sort({ dueDate: 1, _id: 1 }).limit(MAX_ROWS + 1).lean();
  return { columns: withCampus(showCampus, LOAN_COLS), rows: await openLoanRows(docs, { now, showCampus }), totals: null };
}

async function overdue({ scope, showCampus, now, today }) {
  const docs = await Loan.find({ ...scope, status: 'OPEN', dueDate: { $lt: today } })
    .sort({ dueDate: 1, _id: 1 }).limit(MAX_ROWS + 1).lean();
  const periods = await finePeriodModel.loadActive(docs.map((d) => d.campusId));
  const rows = await openLoanRows(docs, {
    now, showCampus,
    extra: (d) => ({ lateFine: fine.lateFine(d, now, { periods: periods.get(String(d.campusId)) || [] }) }),
  });
  rows.sort((a, b) => b.daysLate - a.daysLate);
  return {
    columns: withCampus(showCampus, [...LOAN_COLS, col('lateFine', 'Late fine', 'money')]),
    rows, totals: { lateFine: sumBy(rows, 'lateFine') },
  };
}

async function fineCollection({ scope, showCampus, from, to, params }) {
  const group = params.group || 'day';
  const tz = '+05:30';
  const keyExpr = group === 'staff' ? '$receivedBy'
    : { $dateToString: { format: group === 'month' ? '%Y-%m' : '%Y-%m-%d', date: '$receivedAt', timezone: tz } };
  const agg = await Payment.aggregate([
    { $match: { ...scope, voided: null, receivedAt: dateRange(from, to) } },
    { $group: { _id: { campusId: '$campusId', k: keyExpr }, receipts: { $sum: 1 }, amount: { $sum: '$amount' } } },
  ]);
  const [names, staff] = await Promise.all([
    showCampus ? campusNameMap(agg.map((g) => g._id.campusId)) : new Map(),
    group === 'staff' ? User.find({ _id: { $in: uniq(agg.map((g) => g._id.k)) } }).select('name').lean() : [],
  ]);
  const staffName = new Map(staff.map((u) => [String(u._id), u.name]));
  let rows = agg.map((g) => ({
    ...(showCampus ? { campus: names.get(String(g._id.campusId)) || '' } : {}),
    [group === 'staff' ? 'staff' : 'period']: group === 'staff' ? staffName.get(String(g._id.k)) || 'Unknown' : g._id.k,
    receipts: g.receipts, amount: fine.round2(g.amount),
  }));
  const keyName = group === 'staff' ? 'staff' : 'period';
  rows = rows.sort((a, b) => (a.campus || '').localeCompare(b.campus || '')
    || (group === 'staff' ? b.amount - a.amount : String(a[keyName]).localeCompare(String(b[keyName]))));
  return {
    columns: withCampus(showCampus, [
      group === 'staff' ? col('staff', 'Staff') : col('period', group === 'month' ? 'Month' : 'Date', group === 'month' ? 'text' : 'date'),
      col('receipts', 'Receipts', 'number'), col('amount', 'Amount', 'money'),
    ]),
    rows, totals: { receipts: rows.reduce((t, r) => t + r.receipts, 0), amount: sumBy(rows, 'amount') },
  };
}

async function pendingFines({ scope, showCampus, now }) {
  const { rows: pend } = await finePending.pendingRows({ scope, now });
  const [students, names] = await Promise.all([
    studentInfo(pend.map((r) => r.studentId)),
    showCampus ? campusNameMap(pend.map((r) => r.campusId)) : new Map(),
  ]);
  const rows = pend.map((r) => {
    const st = students.get(r.studentId);
    return {
      ...(showCampus ? { campus: names.get(r.campusId) || '' } : {}),
      student: st?.fullName || '', regNumber: st?.regNumber || '', batch: st?.batch || '',
      isActive: st ? (st.isActive ? 'Yes' : 'No') : '',
      balance: r.balance, accruing: r.accruing, chargeCount: r.chargeCount, oldestChargeAt: dateOf(r.oldestChargeAt),
    };
  });
  return {
    columns: withCampus(showCampus, [
      col('student', 'Student'), col('regNumber', 'Reg number'), col('batch', 'Batch'), col('isActive', 'Active'),
      col('balance', 'Balance', 'money'), col('accruing', 'Accruing', 'money'),
      col('chargeCount', 'Charges', 'number'), col('oldestChargeAt', 'Oldest charge', 'date'),
    ]),
    rows, totals: { balance: sumBy(rows, 'balance'), accruing: sumBy(rows, 'accruing') },
  };
}

async function waivers({ scope, showCampus, from, to, params }) {
  const range = dateRange(from, to);
  const filter = {
    ...scope,
    $or: [{ status: { $ne: 'PENDING' }, decidedAt: range }, { status: 'PENDING', requestedAt: range }],
  };
  if (params.status) filter.status = params.status;
  const docs = await Waiver.find(filter).sort({ requestedAt: -1, _id: -1 }).limit(MAX_ROWS + 1).lean();
  const views = await waiverModel.shapeMany(docs);
  const rows = views.map((w) => ({
    ...(showCampus ? { campus: w.campus?.name || '' } : {}),
    date: dateOf(w.status === 'PENDING' ? w.requestedAt : w.decidedAt),
    student: w.student.fullName, regNumber: w.student.regNumber,
    chargeType: w.charge?.type || '', catalogNumber: w.charge?.copy?.catalogNumber || '',
    type: w.type, status: w.status, amount: w.amount, approvedAmount: w.approvedAmount,
    reason: w.reason, requestedBy: w.requestedBy?.name || '', decidedBy: w.decidedBy?.name || '',
  }));
  return {
    columns: withCampus(showCampus, [
      col('date', 'Date', 'date'), col('student', 'Student'), col('regNumber', 'Reg number'), col('chargeType', 'Charge'),
      col('catalogNumber', 'Catalog no.'), col('type', 'Type'), col('status', 'Status'), col('amount', 'Amount', 'money'),
      col('approvedAmount', 'Approved', 'money'), col('reason', 'Reason'), col('requestedBy', 'Requested by'), col('decidedBy', 'Decided by'),
    ]),
    rows, totals: { amount: sumBy(rows, 'amount'), approvedAmount: sumBy(rows, 'approvedAmount') },
  };
}

async function lostDamaged({ scope, showCampus, from, to }) {
  const range = dateRange(from, to);
  const [lostLoans, damagedLoans, stockLost] = await Promise.all([
    Loan.find({ ...scope, status: 'LOST', lostAt: range }).sort({ lostAt: -1 }).limit(MAX_ROWS + 1).lean(),
    Loan.find({ ...scope, status: 'RETURNED', condition: { $in: ['DAMAGED_MINOR', 'DAMAGED_MAJOR'] }, returnedAt: range })
      .sort({ returnedAt: -1 }).limit(MAX_ROWS + 1).lean(),
    BookCopy.find({ ...scope, lostSource: 'STOCK_CHECK', lostAt: range }).sort({ lostAt: -1 }).limit(MAX_ROWS + 1).lean(),
  ]);
  const loans = [...lostLoans, ...damagedLoans];
  const [charges, students, loanBooks, copies] = await Promise.all([
    loans.length ? Charge.find({ loanId: { $in: loans.map((l) => l._id) }, type: { $in: ['LOST', 'DAMAGE'] } }).lean() : [],
    studentInfo(loans.map((l) => l.studentId)),
    bookInfo([...loans.map((l) => l.bookId), ...stockLost.map((c) => c.bookId)]),
    BookCopy.find({ _id: { $in: uniq(loans.map((l) => l.copyId)) } }).select('catalogNumber').lean(),
  ]);
  const names = showCampus ? await campusNameMap([...loans, ...stockLost].map((x) => x.campusId)) : new Map();
  const cn = new Map(copies.map((c) => [String(c._id), c.catalogNumber]));
  const chargeSums = new Map();
  for (const c of charges) {
    const k = String(c.loanId);
    const cur = chargeSums.get(k) || { charged: 0, paid: 0, waived: 0, balance: 0 };
    cur.charged = fine.round2(cur.charged + c.amount);
    cur.paid = fine.round2(cur.paid + (c.paidAmount || 0));
    cur.waived = fine.round2(cur.waived + (c.waivedAmount || 0));
    cur.balance = fine.round2(cur.balance + chargeModel.balanceOf(c));
    chargeSums.set(k, cur);
  }
  const zero = { charged: 0, paid: 0, waived: 0, balance: 0 };
  const campusCell = (x) => (showCampus ? { campus: names.get(String(x.campusId)) || '' } : {});
  const loanRow = (l, event, at) => {
    const st = students.get(String(l.studentId));
    return {
      ...campusCell(l), catalogNumber: cn.get(String(l.copyId)) || '', title: loanBooks.get(String(l.bookId))?.title || '',
      event, date: dateOf(at), student: st?.fullName || '', regNumber: st?.regNumber || '',
      ...(chargeSums.get(String(l._id)) || zero), found: event === 'LOST_BY_STUDENT' ? dateOf(l.foundAt) : null,
    };
  };
  const rows = [
    ...lostLoans.map((l) => loanRow(l, 'LOST_BY_STUDENT', l.lostAt)),
    ...damagedLoans.map((l) => loanRow(l, l.condition === 'DAMAGED_MAJOR' ? 'DAMAGED_MAJOR' : 'DAMAGED_MINOR', l.returnedAt)),
    ...stockLost.map((c) => ({
      ...campusCell(c), catalogNumber: c.catalogNumber, title: loanBooks.get(String(c.bookId))?.title || '',
      event: 'LOST_STOCK_CHECK', date: dateOf(c.lostAt), student: '', regNumber: '', ...zero,
      found: c.foundAt && c.foundAt >= c.lostAt ? dateOf(c.foundAt) : null,
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return {
    columns: withCampus(showCampus, [
      col('catalogNumber', 'Catalog no.'), col('title', 'Title'), col('event', 'Event'), col('date', 'Date', 'date'),
      col('student', 'Student'), col('regNumber', 'Reg number'), col('charged', 'Charged', 'money'), col('paid', 'Paid', 'money'),
      col('waived', 'Waived', 'money'), col('balance', 'Balance', 'money'), col('found', 'Found', 'date'),
    ]),
    rows, totals: { charged: sumBy(rows, 'charged'), paid: sumBy(rows, 'paid'), waived: sumBy(rows, 'waived'), balance: sumBy(rows, 'balance') },
  };
}

async function mostBorrowed({ scope, showCampus, from, to, params }) {
  const limit = params.limit || 50;
  const agg = await Loan.aggregate([
    { $match: { ...scope, issuedAt: dateRange(from, to) } },
    { $group: { _id: '$bookId', loans: { $sum: 1 } } },
    { $sort: { loans: -1, _id: 1 } },
    { $limit: limit },
  ]);
  const ids = agg.map((g) => g._id);
  const [books, copyCounts] = await Promise.all([
    bookInfo(ids),
    BookCopy.aggregate([{ $match: { bookId: { $in: ids } } }, { $group: { _id: '$bookId', n: { $sum: 1 } } }]),
  ]);
  const cc = new Map(copyCounts.map((c) => [String(c._id), c.n]));
  const names = showCampus ? await campusNameMap([...books.values()].map((b) => b.campusId)) : new Map();
  const rows = agg.map((g) => {
    const b = books.get(String(g._id));
    return {
      ...(showCampus ? { campus: names.get(String(b?.campusId)) || '' } : {}),
      title: b?.title || '', author: b?.author || '', category: b?.category || '',
      copies: cc.get(String(g._id)) || 0, loans: g.loans,
    };
  });
  return {
    columns: withCampus(showCampus, [
      col('title', 'Title'), col('author', 'Author'), col('category', 'Category'), col('copies', 'Copies', 'number'), col('loans', 'Loans', 'number'),
    ]),
    rows, totals: { loans: rows.reduce((t, r) => t + r.loans, 0) },
  };
}

async function neverBorrowed({ scope, showCampus, from }) {
  const cutoff = istStart(from);
  const [bookCopies, borrowedIds] = await Promise.all([
    BookCopy.aggregate([
      { $match: { ...scope, status: { $ne: 'WITHDRAWN' } } },
      { $sort: { seq: 1 } },
      { $group: { _id: '$bookId', copies: { $sum: 1 }, catalogNumbers: { $push: '$catalogNumber' } } },
    ]),
    Loan.distinct('bookId', { ...scope, issuedAt: { $gte: cutoff } }),
  ]);
  const borrowed = new Set(borrowedIds.map(String));
  const candidates = bookCopies.filter((b) => !borrowed.has(String(b._id)));
  const ids = candidates.map((c) => c._id);
  const [books, last] = await Promise.all([
    bookInfo(ids),
    ids.length ? Loan.aggregate([{ $match: { bookId: { $in: ids } } }, { $group: { _id: '$bookId', last: { $max: '$issuedAt' } } }]) : [],
  ]);
  const lastBy = new Map(last.map((l) => [String(l._id), l.last]));
  const names = showCampus ? await campusNameMap([...books.values()].map((b) => b.campusId)) : new Map();
  const rows = candidates.map((c) => {
    const b = books.get(String(c._id));
    const shown = c.catalogNumbers.slice(0, 20).join(', ') + (c.catalogNumbers.length > 20 ? ', …' : '');
    return {
      ...(showCampus ? { campus: names.get(String(b?.campusId)) || '' } : {}),
      title: b?.title || '', author: b?.author || '', category: b?.category || '',
      copies: c.copies, catalogNumbers: shown, lastIssuedAt: dateOf(lastBy.get(String(c._id))),
    };
  }).sort((a, b) => (a.campus || '').localeCompare(b.campus || '') || a.title.localeCompare(b.title)).slice(0, MAX_ROWS + 1);
  return {
    columns: withCampus(showCampus, [
      col('title', 'Book title'), col('author', 'Author'), col('category', 'Category'), col('copies', 'Copies', 'number'),
      col('catalogNumbers', 'Catalog numbers'), col('lastIssuedAt', 'Last issued', 'date'),
    ]),
    rows, totals: null,
  };
}

async function studentBorrowing({ scope, showCampus, from, to, params }) {
  const group = params.group || 'student';
  const agg = await Loan.aggregate([
    { $match: { ...scope, issuedAt: dateRange(from, to) } },
    { $group: {
      _id: { studentId: '$studentId', campusId: group === 'student' && showCampus ? '$campusId' : null },
      loans: { $sum: 1 },
      overdueReturns: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'OPEN'] }, { $gt: [{ $ifNull: ['$fineDays', 0] }, 0] }] }, 1, 0] } },
      finesCharged: { $sum: { $ifNull: ['$fineAmount', 0] } },
    } },
  ]);
  const students = await studentInfo(agg.map((g) => g._id.studentId));

  if (group === 'batch') {
    const byBatch = new Map();
    for (const g of agg) {
      const st = students.get(String(g._id.studentId));
      const key = st?.batch || '(no batch)';
      const cur = byBatch.get(key) || { batch: key, students: 0, loans: 0 };
      cur.students += 1; cur.loans += g.loans;
      byBatch.set(key, cur);
    }
    const rows = [...byBatch.values()].sort((a, b) => b.loans - a.loans || a.batch.localeCompare(b.batch)).slice(0, 500);
    return {
      columns: [col('batch', 'Batch'), col('students', 'Students', 'number'), col('loans', 'Loans', 'number')],
      rows, totals: { students: rows.reduce((t, r) => t + r.students, 0), loans: rows.reduce((t, r) => t + r.loans, 0) },
    };
  }

  agg.sort((a, b) => b.loans - a.loans || String(a._id.studentId).localeCompare(String(b._id.studentId)));
  const top = agg.slice(0, 500);
  const names = showCampus ? await campusNameMap(top.map((g) => g._id.campusId)) : new Map();
  const rows = top.map((g) => {
    const st = students.get(String(g._id.studentId));
    return {
      ...(showCampus ? { campus: names.get(String(g._id.campusId)) || '' } : {}),
      student: st?.fullName || '', regNumber: st?.regNumber || '', batch: st?.batch || '',
      loans: g.loans, overdueReturns: g.overdueReturns, finesCharged: fine.round2(g.finesCharged),
    };
  });
  return {
    columns: withCampus(showCampus, [
      col('student', 'Student'), col('regNumber', 'Reg number'), col('batch', 'Batch'), col('loans', 'Loans', 'number'),
      col('overdueReturns', 'Overdue returns', 'number'), col('finesCharged', 'Fines charged', 'money'),
    ]),
    rows, totals: { loans: rows.reduce((t, r) => t + r.loans, 0), overdueReturns: rows.reduce((t, r) => t + r.overdueReturns, 0), finesCharged: sumBy(rows, 'finesCharged') },
  };
}

async function campusComparison({ scope, from, to, today }) {
  const campusMatch = scope.campusId ? { _id: scope.campusId } : { isActive: true };
  const campuses = await Campus.find(campusMatch).select('name').sort({ name: 1 }).lean();
  const ids = campuses.map((c) => c._id);
  const inIds = { campusId: { $in: ids } };
  const [titles, byStatus, overdueNow, loansIn, collected, pending] = await Promise.all([
    Book.aggregate([{ $match: inIds }, { $group: { _id: '$campusId', n: { $sum: 1 } } }]),
    BookCopy.aggregate([{ $match: inIds }, { $group: { _id: { c: '$campusId', s: '$status' }, n: { $sum: 1 } } }]),
    Loan.aggregate([{ $match: { ...inIds, status: 'OPEN', dueDate: { $lt: today } } }, { $group: { _id: '$campusId', n: { $sum: 1 } } }]),
    Loan.aggregate([{ $match: { ...inIds, issuedAt: dateRange(from, to) } }, { $group: { _id: '$campusId', n: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: { ...inIds, voided: null, receivedAt: dateRange(from, to) } },
      { $group: { _id: '$campusId', n: { $sum: '$amount' } } },
    ]),
    Charge.aggregate([
      { $match: { ...inIds, status: { $in: finePending.OPEN_STATUSES } } },
      { $group: { _id: '$campusId', n: { $sum: chargeModel.BALANCE_EXPR } } },
    ]),
  ]);
  const toMap = (arr) => new Map(arr.map((x) => [String(x._id), x.n]));
  const t = toMap(titles); const od = toMap(overdueNow); const li = toMap(loansIn); const co = toMap(collected); const pe = toMap(pending);
  const st = new Map(byStatus.map((x) => [`${x._id.c}|${x._id.s}`, x.n]));
  const rows = campuses.map((c) => {
    const k = String(c._id);
    const n = (s) => st.get(`${k}|${s}`) || 0;
    const copies = ['AVAILABLE', 'ISSUED', 'LOST', 'DAMAGED', 'WITHDRAWN'].reduce((s, x) => s + n(x), 0);
    return {
      campus: c.name, titles: t.get(k) || 0, copies, available: n('AVAILABLE'), issuedNow: n('ISSUED'),
      overdueNow: od.get(k) || 0, loansInRange: li.get(k) || 0,
      collected: fine.round2(co.get(k) || 0), pendingBalance: fine.round2(Math.max(0, pe.get(k) || 0)),
    };
  });
  const numKeys = ['titles', 'copies', 'available', 'issuedNow', 'overdueNow', 'loansInRange'];
  return {
    columns: [
      col('campus', 'Campus'), col('titles', 'Titles', 'number'), col('copies', 'Copies', 'number'), col('available', 'Available', 'number'),
      col('issuedNow', 'Issued now', 'number'), col('overdueNow', 'Overdue now', 'number'), col('loansInRange', 'Loans in range', 'number'),
      col('collected', 'Collected', 'money'), col('pendingBalance', 'Pending balance', 'money'),
    ],
    rows,
    totals: { ...Object.fromEntries(numKeys.map((k) => [k, rows.reduce((s, r) => s + r[k], 0)])), collected: sumBy(rows, 'collected'), pendingBalance: sumBy(rows, 'pendingBalance') },
  };
}

const REPORTS = {
  'stock-summary': { title: 'Stock summary', run: stockSummary },
  issued: { title: 'Issued books', run: issued },
  overdue: { title: 'Overdue books', run: overdue },
  'fine-collection': { title: 'Fine collection', run: fineCollection },
  'pending-fines': { title: 'Pending fines', run: pendingFines },
  waivers: { title: 'Waivers', run: waivers },
  'lost-damaged': { title: 'Lost and damaged books', run: lostDamaged },
  'most-borrowed': { title: 'Most borrowed books', run: mostBorrowed },
  'never-borrowed': { title: 'Never borrowed books', run: neverBorrowed },
  'student-borrowing': { title: 'Student borrowing', run: studentBorrowing },
  'campus-comparison': { title: 'Campus comparison', run: campusComparison, adminOnly: true },
};

module.exports = { MAX_ROWS, REPORTS, WAIVER_STATUSES, monthsBefore, defaultRange };
