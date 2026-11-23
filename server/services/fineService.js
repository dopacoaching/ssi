// Pure date / fine maths for the library circulation module (no DB, no I/O).
// Every calendar calculation is done in Asia/Kolkata. India has no DST and is a
// fixed UTC+05:30, so a constant offset is exact and needs no dependency.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Date -> 'YYYY-MM-DD' (IST calendar date).
const istDate = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

// 'YYYY-MM-DD' -> whole days since the epoch (UTC midnight of that calendar date).
const ymdToDays = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

const daysToYmd = (days) => new Date(days * DAY_MS).toISOString().slice(0, 10);

const addDays = (ymd, n) => daysToYmd(ymdToDays(ymd) + n);

// diffDays(a, b) = a - b in whole calendar days.
const diffDays = (aYmd, bYmd) => ymdToDays(aYmd) - ymdToDays(bYmd);

// dueDate = IST date of issue + loanDays.
const dueDateFor = (issuedAt, loanDays) => addDays(istDate(issuedAt), loanDays);

// The instant a loan's lateness is measured to: returned, else lost, else `asOf`.
const endAtFor = (loan, asOf = new Date()) => loan.returnedAt || loan.lostAt || asOf;

// Whole IST calendar days past the due date (0 when on time) - RAW, ignoring no-fine periods.
// `waivedDays` is an optional extra reduction (never takes the result below 0).
const daysLate = (loan, asOf = new Date(), { waivedDays = 0 } = {}) =>
  Math.max(0, diffDays(istDate(endAtFor(loan, asOf)), loan.dueDate) - Math.max(0, waivedDays));

// Number of distinct calendar days d with fromExclusive < d <= toInclusive that fall inside ANY
// period ({ from, to } YYYY-MM-DD, `to` inclusive). Overlapping periods are merged, so each
// day counts once.
const periodOverlapDays = (fromExclusiveYmd, toInclusiveYmd, periods = []) => {
  const lo = ymdToDays(fromExclusiveYmd) + 1;
  const hi = ymdToDays(toInclusiveYmd);
  if (!periods || periods.length === 0 || hi < lo) return 0;
  const ranges = periods
    .map((p) => [Math.max(lo, ymdToDays(p.from)), Math.min(hi, ymdToDays(p.to))])
    .filter(([a, b]) => a <= b)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curEnd = -Infinity;
  for (const [a, b] of ranges) {
    const start = Math.max(a, curEnd + 1);
    if (b >= start) total += b - start + 1;
    if (b > curEnd) curEnd = b;
  }
  return total;
};

// ---- inclusive day-range helpers ({ from, to } YYYY-MM-DD) ----

// Sorted, merged (overlapping AND adjacent ranges joined) copy of `ranges`.
const mergeRanges = (ranges = []) => {
  const sorted = (ranges || [])
    .map((r) => [ymdToDays(r.from), ymdToDays(r.to)])
    .filter(([a, b]) => a <= b)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => ({ from: daysToYmd(a), to: daysToYmd(b) }));
};

// Total distinct days in `ranges`.
const countRangeDays = (ranges = []) =>
  mergeRanges(ranges).reduce((t, r) => t + ymdToDays(r.to) - ymdToDays(r.from) + 1, 0);

// Merged ranges of `a` with every day that is in `b` removed.
const subtractRanges = (a = [], b = []) => {
  const minus = mergeRanges(b).map((r) => [ymdToDays(r.from), ymdToDays(r.to)]);
  const out = [];
  for (const r of mergeRanges(a)) {
    let cur = ymdToDays(r.from);
    const end = ymdToDays(r.to);
    for (const [x, y] of minus) {
      if (y < cur || x > end) continue;
      if (x > cur) out.push([cur, x - 1]);
      cur = Math.max(cur, y + 1);
      if (cur > end) break;
    }
    if (cur <= end) out.push([cur, end]);
  }
  return out.map(([x, y]) => ({ from: daysToYmd(x), to: daysToYmd(y) }));
};

// Merged ranges of the days d (fromExclusive < d <= toInclusive) that lie inside any period.
const overlapRanges = (fromExclusiveYmd, toInclusiveYmd, periods = []) => {
  const lo = addDays(fromExclusiveYmd, 1);
  if (ymdToDays(toInclusiveYmd) < ymdToDays(lo)) return [];
  return mergeRanges((periods || []).map((p) => ({
    from: ymdToDays(p.from) < ymdToDays(lo) ? lo : p.from,
    to: ymdToDays(p.to) > ymdToDays(toInclusiveYmd) ? toInclusiveYmd : p.to,
  })));
};

// Everything the UI / ledger needs for one loan's late fine under the no-fine periods.
//   daysLate (raw), waivedDays (period overlap, capped at raw), chargeableDays, lateFine.
const fineBreakdown = (loan, asOf = new Date(), periods = []) => {
  const raw = daysLate(loan, asOf);
  const end = istDate(endAtFor(loan, asOf));
  const waivedRanges = raw > 0 ? overlapRanges(loan.dueDate, end, periods) : [];
  const waived = Math.min(raw, countRangeDays(waivedRanges));
  const chargeable = raw - waived;
  return {
    daysLate: raw, waivedDays: waived, waivedRanges, chargeableDays: chargeable,
    lateFine: round2(chargeable * (loan.finePerDay || 0)),
  };
};

// Days that are actually charged: raw days late minus days inside no-fine periods.
const chargeableDays = (loan, asOf = new Date(), periods = []) =>
  fineBreakdown(loan, asOf, periods).chargeableDays;

// Late fine in rupees (2 decimals) = chargeable days x finePerDay. `periods` are the active
// no-fine periods of the loan's campus; `waivedAmount` / `waivedDays` are optional extras.
const lateFine = (loan, asOf = new Date(), { waivedAmount = 0, waivedDays = 0, periods = [] } = {}) => {
  const days = Math.max(0, chargeableDays(loan, asOf, periods) - Math.max(0, waivedDays));
  return Math.max(0, round2(days * (loan.finePerDay || 0) - Math.max(0, waivedAmount)));
};

// Overdue <=> OPEN and today (IST) is after the due date.
const isOverdue = (loan, now = new Date()) =>
  loan.status === 'OPEN' && diffDays(istDate(now), loan.dueDate) > 0;

// { allowed, reason }. Renewal needs OPEN, renewCount < maxRenewals and today <= dueDate.
const renewalCheck = (loan, { maxRenewals }, now = new Date()) => {
  if (loan.status !== 'OPEN') return { allowed: false, reason: 'This loan is already closed' };
  const count = loan.renewCount || 0;
  if (count >= maxRenewals) {
    if (maxRenewals <= 0) return { allowed: false, reason: 'Renewals are not allowed' };
    return {
      allowed: false,
      reason: maxRenewals === 1 ? 'Already renewed once' : `Already renewed ${count} times (maximum ${maxRenewals})`,
    };
  }
  if (isOverdue(loan, now)) return { allowed: false, reason: 'Overdue books cannot be renewed' };
  return { allowed: true, reason: null };
};

// New due date on renewal = today (IST) + the loan's own loanDays snapshot.
const renewedDueDate = (loan, now = new Date()) => addDays(istDate(now), loan.loanDays);

module.exports = {
  IST_OFFSET_MS, DAY_MS, round2, istDate, ymdToDays, daysToYmd, addDays, diffDays, dueDateFor, endAtFor,
  daysLate, periodOverlapDays, mergeRanges, countRangeDays, subtractRanges, overlapRanges, fineBreakdown, chargeableDays, lateFine, isOverdue, renewalCheck, renewedDueDate,
};
