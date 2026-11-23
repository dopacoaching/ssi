// Manual validation helpers for the Phase 4 (fines & payments) endpoints. Pure - no DB.
const { mongoose } = require('./db');
const { round2, ymdToDays, daysToYmd, istDate } = require('../services/fineService');

const MAX_MONEY = 10000000;
const MAX_ALLOCATIONS = 50;
const MAX_PERIOD_DAYS = 366;
const REASON_MAX = 500;

const isBlank = (v) => v === undefined || v === null || v === '';

const cleanObjectId = (v, label) => {
  if (typeof v !== 'string' || !mongoose.isValidObjectId(v) || !/^[a-f\d]{24}$/i.test(v)) return { error: `Invalid ${label}` };
  return { value: v };
};

// Strictly positive rupee amount with at most 2 decimals. Numbers or numeric strings.
function cleanPositiveMoney(v, label) {
  let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) n = Number(v.trim());
  if (!Number.isFinite(n) || n <= 0) return { error: `${label} must be a number greater than 0` };
  if (n > MAX_MONEY) return { error: `${label} is too large` };
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { error: `${label} can have at most 2 decimal places` };
  const value = round2(n);
  if (value <= 0) return { error: `${label} must be a number greater than 0` };
  return { value };
}

// Required free text: trimmed, 1..max chars.
function cleanRequiredText(v, label, max = REASON_MAX) {
  if (typeof v !== 'string' || !v.trim()) return { error: `${label} is required` };
  const s = v.trim();
  if (s.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return { value: s };
}

// Optional free text ('' when blank).
function cleanOptionalText(v, label, max = REASON_MAX) {
  if (isBlank(v)) return { value: '' };
  if (typeof v !== 'string') return { error: `${label} must be text` };
  const s = v.trim();
  if (s.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return { value: s };
}

// A REAL calendar date as 'YYYY-MM-DD' (rejects 2026-02-30, 2026-13-01, '2026-1-1', non-strings).
function cleanYmd(v, label) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: `${label} must be a date (YYYY-MM-DD)` };
  const [y, m] = v.split('-').map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12) return { error: `${label} is not a valid date` };
  if (daysToYmd(ymdToDays(v)) !== v) return { error: `${label} is not a valid date` };
  return { value: v };
}

// { from, to } both valid, from <= to, inclusive span <= 366 days.
function cleanDateRange(rawFrom, rawTo) {
  const from = cleanYmd(rawFrom, 'From date');
  if (from.error) return from;
  const to = cleanYmd(rawTo, 'To date');
  if (to.error) return to;
  if (from.value > to.value) return { error: 'From date cannot be after To date' };
  if (ymdToDays(to.value) - ymdToDays(from.value) + 1 > MAX_PERIOD_DAYS) {
    return { error: `A period can span at most ${MAX_PERIOD_DAYS} days` };
  }
  return { value: { from: from.value, to: to.value } };
}

// Allocations: 1..50 entries, valid distinct chargeIds, each amount > 0 (<= 2 dp).
// `amount` (optional) must equal the sum (+-0.001). Returns { value: { allocations, total } } | { error }.
function validateAllocations(rawAllocations, rawAmount) {
  if (!Array.isArray(rawAllocations) || rawAllocations.length === 0) return { error: 'Select at least one charge to pay' };
  if (rawAllocations.length > MAX_ALLOCATIONS) return { error: `At most ${MAX_ALLOCATIONS} charges can be paid in one receipt` };
  const seen = new Set();
  const allocations = [];
  let total = 0;
  for (const a of rawAllocations) {
    if (!a || typeof a !== 'object') return { error: 'Invalid allocation' };
    const id = cleanObjectId(a.chargeId, 'charge');
    if (id.error) return id;
    const key = id.value.toLowerCase();
    if (seen.has(key)) return { error: 'The same charge appears more than once' };
    seen.add(key);
    const amt = cleanPositiveMoney(a.amount, 'Allocation amount');
    if (amt.error) return amt;
    allocations.push({ chargeId: id.value, amount: amt.value });
    total = round2(total + amt.value);
  }
  if (!isBlank(rawAmount)) {
    const amt = cleanPositiveMoney(rawAmount, 'Amount');
    if (amt.error) return amt;
    if (Math.abs(amt.value - total) > 0.001) return { error: 'Amount must equal the sum of the allocations' };
  }
  return { value: { allocations, total } };
}

// Client idempotency key: 8-64 chars of [A-Za-z0-9_-].
function cleanRequestId(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) return { error: 'A valid request id is required (8-64 letters, digits, - or _)' };
  return { value: v };
}

// 'true' | 'false' | boolean | undefined -> boolean (default when undefined). null on garbage.
function cleanBool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return null;
}

const todayIst = () => istDate(new Date());

module.exports = {
  MAX_ALLOCATIONS, MAX_PERIOD_DAYS, REASON_MAX, isBlank, cleanObjectId, cleanPositiveMoney, cleanRequiredText,
  cleanOptionalText, cleanYmd, cleanDateRange, validateAllocations, cleanRequestId, cleanBool, todayIst,
};
