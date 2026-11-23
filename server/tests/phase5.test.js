// Phase 5 pure-function tests. Run from server/:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultRange, monthsBefore } = require('../services/reportService');
const { parseParams } = require('../controllers/reportsController');
const { classifyScan, scanMessage, computeMissing } = require('../services/stockCheckService');
const { summarizeDues, describeDues } = require('../services/clearanceService');
const fine = require('../services/fineService');

const at = (ymd, hm = '12:00') => new Date(`${ymd}T${hm}:00+05:30`);

test('report date-range defaults', () => {
  const now = at('2026-11-23');
  assert.deepEqual(defaultRange('fine-collection', now), { from: '2026-11-01', to: '2026-11-23' });
  assert.deepEqual(defaultRange('waivers', now), { from: '2026-11-01', to: '2026-11-23' });
  assert.deepEqual(defaultRange('campus-comparison', now), { from: '2026-11-01', to: '2026-11-23' });
  assert.deepEqual(defaultRange('lost-damaged', now), { from: '2026-01-01', to: '2026-11-23' });
  assert.deepEqual(defaultRange('most-borrowed', now), { from: '2025-11-23', to: '2026-11-23' });
  assert.deepEqual(defaultRange('student-borrowing', now), { from: '2025-11-23', to: '2026-11-23' });
  assert.deepEqual(defaultRange('never-borrowed', now, { months: 6 }), { from: '2026-05-23', to: '2026-11-23' });
  assert.deepEqual(defaultRange('stock-summary', now), { from: null, to: null });
  assert.deepEqual(defaultRange('issued', now), { from: null, to: null });
  // IST day, not UTC: 00:30 IST on the 1st is still the 1st (UTC is the 30th)
  assert.deepEqual(defaultRange('fine-collection', at('2026-12-01', '00:30')), { from: '2026-12-01', to: '2026-12-01' });
  assert.equal(monthsBefore('2026-03-31', 1), '2026-02-28');
  assert.equal(monthsBefore('2024-02-29', 12), '2023-02-28');
  assert.equal(monthsBefore('2026-01-15', 2), '2025-11-15');
});

test('report param validation', () => {
  const st = ['PENDING', 'APPROVED', 'REJECTED'];
  assert.deepEqual(parseParams('fine-collection', {}, st), { params: { group: 'day' } });
  assert.ok(parseParams('fine-collection', { group: 'x' }, st).error);
  assert.deepEqual(parseParams('student-borrowing', { group: 'batch' }, st), { params: { group: 'batch' } });
  assert.ok(parseParams('waivers', { status: 'NOPE' }, st).error);
  assert.equal(parseParams('most-borrowed', {}, st).params.limit, 50);
  assert.ok(parseParams('most-borrowed', { limit: '201' }, st).error);
  assert.equal(parseParams('never-borrowed', { months: '3' }, st).params.months, 3);
  assert.ok(parseParams('never-borrowed', { months: '0' }, st).error);
});

test('scan result classification', () => {
  assert.deepEqual(classifyScan({ copy: null }), { result: 'NOT_FOUND', record: false });
  assert.deepEqual(classifyScan({ copy: null, existsElsewhere: true }), { result: 'WRONG_CAMPUS', record: false });
  assert.deepEqual(classifyScan({ copy: { status: 'AVAILABLE' } }), { result: 'OK', record: true });
  for (const s of ['ISSUED', 'LOST', 'DAMAGED', 'WITHDRAWN']) {
    assert.deepEqual(classifyScan({ copy: { status: s } }), { result: s, record: true });
  }
  assert.equal(scanMessage('ISSUED', { regNumber: '23R1045' }), 'Marked Issued to 23R1045 — check the loan');
  assert.equal(scanMessage('LOST'), 'Marked Lost — use Mark found');
});

test('missing snapshot = AVAILABLE copies without a scan', () => {
  const copies = [
    { _id: 'a', status: 'AVAILABLE', catalogNumber: 'IG1-2', bookId: 'b1', seq: 2, shelfLocation: 'A' },
    { _id: 'b', status: 'AVAILABLE', catalogNumber: 'IG1-1', bookId: 'b1', seq: 1, shelfLocation: 'A' },
    { _id: 'c', status: 'ISSUED', catalogNumber: 'IG1-3', bookId: 'b2', seq: 3, shelfLocation: 'B' },
    { _id: 'd', status: 'AVAILABLE', catalogNumber: 'IG1-4', bookId: 'b2', seq: 4, shelfLocation: 'B' },
  ];
  const m = computeMissing(copies, new Set(['d']), new Map([['b1', 'Title 1']]));
  assert.deepEqual(m.map((x) => x.catalogNumber), ['IG1-1', 'IG1-2']);
  assert.equal(m[0].title, 'Title 1');
  assert.equal(m[0].markedLostAt, null);
});

test('duesFor summarising with a fixed ledger', () => {
  const now = at('2026-11-23');
  const ledger = {
    openLoans: [
      { _id: 'l1', campusId: 'c1', copyId: 'cp1', dueDate: '2026-11-20', finePerDay: 2, status: 'OPEN' },   // 3 days late = 6
      { _id: 'l2', campusId: 'c2', copyId: 'cp2', dueDate: '2026-11-30', finePerDay: 2, status: 'OPEN' },   // not due
    ],
    charges: [
      { _id: 'ch1', campusId: 'c1', copyId: 'cp1', type: 'LOST', amount: 100, paidAmount: 40, waivedAmount: 10 }, // 50
      { _id: 'ch2', campusId: 'c2', copyId: 'cp2', type: 'LATE', amount: 5, paidAmount: 5, waivedAmount: 0 },     // settled, hidden
    ],
    periods: new Map(),
  };
  const lookups = {
    campuses: new Map([['c1', { id: 'c1', name: 'One', code: 'IG-1' }], ['c2', { id: 'c2', name: 'Two', code: 'IG-2' }]]),
    copies: new Map([['cp1', { catalogNumber: 'IG1-1', bookId: 'b1' }], ['cp2', { catalogNumber: 'IG2-1', bookId: 'b2' }]]),
    books: new Map([['b1', { title: 'Alpha' }], ['b2', { title: 'Beta' }]]),
  };
  const d = summarizeDues(ledger, lookups, now);
  assert.equal(d.openLoans.length, 2);
  assert.deepEqual(d.openLoans[0], {
    loanId: 'l1', campus: lookups.campuses.get('c1'), catalogNumber: 'IG1-1', title: 'Alpha',
    dueDate: '2026-11-20', daysLate: 3, lateFine: 6, isOverdue: true,
  });
  assert.equal(d.openLoans[1].isOverdue, false);
  assert.equal(d.charges.length, 1);
  assert.equal(d.charges[0].balance, 50);
  assert.equal(d.outstanding, 56);
  assert.equal(d.isClear, false);
  assert.equal(describeDues(d), '2 books, ₹56');

  const clear = summarizeDues({ openLoans: [], charges: [{ _id: 'x', campusId: 'c1', copyId: 'cp1', type: 'LATE', amount: 5, paidAmount: 5 }], periods: new Map() }, lookups, now);
  assert.equal(clear.isClear, true);
  assert.equal(describeDues(clear), '');
  // A no-fine period applies to the live fine
  const waived = summarizeDues({ ...ledger, charges: [], periods: new Map([['c1', [{ from: '2026-11-21', to: '2026-11-22' }]]]) }, lookups, now);
  assert.equal(waived.openLoans[0].lateFine, 2);
  assert.equal(waived.outstanding, 2);
});

test('lost loan fine is frozen at lostAt', () => {
  const loan = { dueDate: '2026-11-10', finePerDay: 2, lostAt: at('2026-11-14'), returnedAt: null };
  const early = fine.fineBreakdown(loan, loan.lostAt, []);
  const later = fine.fineBreakdown(loan, at('2027-01-01'), []);
  assert.equal(early.daysLate, 4);
  assert.equal(early.lateFine, 8);
  assert.deepEqual(later, early);
  // no-fine days inside (dueDate, lostAt] are excluded and recorded as waivedRanges
  const withPeriod = fine.fineBreakdown(loan, loan.lostAt, [{ from: '2026-11-12', to: '2026-11-13' }]);
  assert.equal(withPeriod.waivedDays, 2);
  assert.equal(withPeriod.lateFine, 4);
  assert.deepEqual(withPeriod.waivedRanges, [{ from: '2026-11-12', to: '2026-11-13' }]);
  // lost before the due date -> nothing
  assert.equal(fine.fineBreakdown({ ...loan, lostAt: at('2026-11-09') }, at('2026-12-01'), []).lateFine, 0);
});
