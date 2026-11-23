// "Library dues" of one student across ALL campuses (No-Dues certificate, deactivation warning).
// The fine maths come from the existing ledger helpers (loadLedger / summarizeLedger) and
// fineService - nothing is re-implemented here. No req/res.
const { BookCopy, Book } = require('../models/schemas');
const campusModel = require('../models/campusModel');
const chargeModel = require('../models/chargeModel');
const circulation = require('./circulationService');
const fine = require('./fineService');

// Pure. `ledger` = { openLoans, charges, periods } (raw docs, as loadLedger returns).
// `lookups` = { campuses: Map<campusId, {id,name,code}>, copies: Map<copyId, {catalogNumber, bookId}>,
//               books: Map<bookId, {title}> } (plain Maps of string ids).
// Returns { openLoans, charges, outstanding, isClear }.
function summarizeDues(ledger, lookups = {}, now = new Date()) {
  const campuses = lookups.campuses || new Map();
  const copies = lookups.copies || new Map();
  const books = lookups.books || new Map();
  const campusOf = (id) => campuses.get(String(id)) || null;
  const labelOf = (copyId) => {
    const c = copies.get(String(copyId));
    const b = c ? books.get(String(c.bookId)) : null;
    return { catalogNumber: c?.catalogNumber || '', title: b?.title || '' };
  };

  const openLoans = (ledger.openLoans || [])
    .map((l) => {
      const bd = fine.fineBreakdown(l, now, ledger.periods?.get(String(l.campusId)) || []);
      return {
        loanId: String(l._id), campus: campusOf(l.campusId), ...labelOf(l.copyId),
        dueDate: l.dueDate, daysLate: bd.daysLate, lateFine: bd.lateFine, isOverdue: fine.isOverdue(l, now),
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const charges = (ledger.charges || [])
    .map((c) => ({ c, balance: chargeModel.balanceOf(c) }))
    .filter((x) => x.balance > 0)
    .map(({ c, balance }) => ({
      chargeId: String(c._id), campus: campusOf(c.campusId), type: c.type, ...labelOf(c.copyId), balance,
    }));

  const outstanding = circulation.summarizeLedger(ledger, now).total;
  return { openLoans, charges, outstanding, isClear: openLoans.length === 0 && charges.length === 0 && outstanding === 0 };
}

// Loads the ledger + display lookups (3 batched queries) and summarises.
async function duesFor(studentId, { now = new Date(), ledger: given } = {}) {
  const ledger = given || await circulation.loadLedger(studentId);
  const copyIds = [...new Set([...ledger.openLoans, ...ledger.charges].map((x) => String(x.copyId)))];
  const copyDocs = copyIds.length ? await BookCopy.find({ _id: { $in: copyIds } }).select('catalogNumber bookId').lean() : [];
  const bookIds = [...new Set(copyDocs.map((c) => String(c.bookId)))];
  const [bookDocs, campuses] = await Promise.all([
    bookIds.length ? Book.find({ _id: { $in: bookIds } }).select('title').lean() : [],
    campusModel.summariesByIds([...ledger.openLoans, ...ledger.charges].map((x) => x.campusId)),
  ]);
  return summarizeDues(ledger, {
    campuses,
    copies: new Map(copyDocs.map((c) => [String(c._id), c])),
    books: new Map(bookDocs.map((b) => [String(b._id), b])),
  }, now);
}

// "1 book, ₹40" style suffix for audit descriptions ('' when clear).
function describeDues(dues) {
  if (dues.isClear) return '';
  const n = dues.openLoans.length;
  const parts = [];
  if (n > 0) parts.push(`${n} book${n === 1 ? '' : 's'}`);
  parts.push(`₹${circulation.money(dues.outstanding)}`);
  return parts.join(', ');
}

module.exports = { summarizeDues, duesFor, describeDues };
