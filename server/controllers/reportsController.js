// Library Phase 5: GET /library/reports/:type (generic table payload for on-screen + Excel/PDF).
const reports = require('../services/reportService');
const fine = require('../services/fineService');
const campusModel = require('../models/campusModel');
const { cleanYmd } = require('../utils/fineValidation');
const { logError } = require('../utils/audit');
const { ok, badRequest, forbidden, notFound } = require('../views/response');
const { readScope, deny, isBlank } = require('./circulationController');

const intIn = (v, min, max, label) => {
  if (isBlank(v)) return { value: undefined };
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${label} must be a whole number between ${min} and ${max}` };
  return { value: n };
};

// Pure: validates + normalises the report-specific query params. { params } | { error }.
function parseParams(type, q, statuses) {
  const params = {};
  if (type === 'fine-collection') {
    if (!isBlank(q.group) && !['day', 'month', 'staff'].includes(q.group)) return { error: 'Invalid group' };
    params.group = q.group || 'day';
  }
  if (type === 'student-borrowing') {
    if (!isBlank(q.group) && !['student', 'batch'].includes(q.group)) return { error: 'Invalid group' };
    params.group = q.group || 'student';
  }
  if (type === 'waivers' && !isBlank(q.status)) {
    if (!statuses.includes(q.status)) return { error: 'Invalid status' };
    params.status = q.status;
  }
  if (type === 'most-borrowed') {
    const l = intIn(q.limit, 1, 200, 'Limit');
    if (l.error) return l;
    params.limit = l.value || 50;
  }
  if (type === 'never-borrowed') {
    const m = intIn(q.months, 1, 120, 'Months');
    if (m.error) return m;
    params.months = m.value || 12;
  }
  return { params };
}

async function run(req, res) {
  const { type } = req.params;
  const def = Object.prototype.hasOwnProperty.call(reports.REPORTS, type) ? reports.REPORTS[type] : null;
  if (!def) return notFound(res, 'Unknown report');
  if (def.adminOnly && !req.library.isAdmin) {
    logError(req, 403, `Non-admin attempted the ${type} report - ${req.method} ${req.originalUrl}`);
    return forbidden(res, 'Only an administrator can do this');
  }
  const q = req.query;
  for (const k of ['from', 'to', 'group', 'status', 'limit', 'months', 'campusId']) {
    if (q[k] !== undefined && typeof q[k] !== 'string') return badRequest(res, `Invalid ${k}`);
  }
  const s = readScope(req, q.campusId || undefined);
  if (s.error) return badRequest(res, s.error);
  if (s.denied) return deny(req, res, 'reports');
  const p = parseParams(type, q, reports.WAIVER_STATUSES);
  if (p.error) return badRequest(res, p.error);

  const now = new Date();
  const def0 = reports.defaultRange(type, now, { months: p.params.months });
  let { from, to } = def0;
  if (type !== 'never-borrowed' && (!isBlank(q.from) || !isBlank(q.to)) && def0.from !== null) {
    const f = isBlank(q.from) ? { value: def0.from } : cleanYmd(q.from, 'From date');
    if (f.error) return badRequest(res, f.error);
    const t = isBlank(q.to) ? { value: f.value > def0.to ? f.value : def0.to } : cleanYmd(q.to, 'To date');
    if (t.error) return badRequest(res, t.error);
    if (f.value > t.value) return badRequest(res, 'From date cannot be after To date');
    from = f.value; to = t.value;
  }

  const showCampus = req.library.isAdmin && !s.scope.campusId;
  const out = await def.run({
    scope: s.scope, showCampus, from, to, params: p.params, now, today: fine.istDate(now), userId: req.user.id,
  });
  const truncated = out.rows.length > reports.MAX_ROWS;
  const campus = s.scope.campusId ? (await campusModel.summariesByIds([s.scope.campusId])).get(String(s.scope.campusId)) || null : null;
  return ok(res, {
    type, title: def.title, campus, from, to, generatedAt: now,
    columns: out.columns, rows: truncated ? out.rows.slice(0, reports.MAX_ROWS) : out.rows, totals: out.totals,
    ...(truncated ? { truncated: true } : {}),
  });
}

module.exports = { run, parseParams };
