const mongoose = require('mongoose');
const campusModel = require('../models/campusModel');
const librarySettingsModel = require('../models/librarySettingsModel');
const { Loan, Charge, StockCheck } = require('../models/schemas');
const { cleanStringList } = require('../utils/validation');
const { logAudit } = require('../utils/audit');
const { ok, created, badRequest, notFound } = require('../views/response');

const CODE_RE = /^[A-Z0-9]{2,6}$/;
const TEXT_FIELDS = ['libraryName', 'receiptAddress', 'receiptPhone', 'openingHours'];
const LIST_FIELDS = ['shelfLocations', 'categories'];
const MAX_TEXT = 300;
const MAX_NAME = 60;

// Validates the shared writable fields present in `body` into `data`.
// Returns an error message string, or null.
function collectFields(body, data) {
  for (const f of TEXT_FIELDS) {
    if (body[f] === undefined) continue;
    if (body[f] !== null && typeof body[f] !== 'string') return `${f} must be a string`;
    const v = (body[f] || '').trim();
    if (v.length > MAX_TEXT) return `${f} must be ${MAX_TEXT} characters or fewer`;
    data[f] = v;
  }
  for (const f of LIST_FIELDS) {
    if (body[f] === undefined) continue;
    const r = cleanStringList(body[f], f);
    if (r.error) return r.error;
    data[f] = r.value;
  }
  return null;
}

function validName(name) {
  if (typeof name !== 'string' || !name.trim()) return 'Campus name is required';
  if (name.trim().length > MAX_NAME) return `Campus name must be ${MAX_NAME} characters or fewer`;
  return null;
}

async function listCampuses(req, res) {
  const campuses = await campusModel.findAll({ includeInactive: true, withBatches: true });
  return ok(res, campuses);
}

async function createCampus(req, res) {
  const body = req.body || {};
  const nameErr = validName(body.name);
  if (nameErr) return badRequest(res, nameErr);
  const name = body.name.trim();
  if (typeof body.code !== 'string' || !body.code.trim()) return badRequest(res, 'Campus code is required');
  const code = body.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) return badRequest(res, 'Campus code must be 2-6 letters or digits');

  const data = { name, code };
  const fieldErr = collectFields(body, data);
  if (fieldErr) return badRequest(res, fieldErr);

  const dupes = await campusModel.findByNameOrCode({ name, code });
  if (dupes.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return badRequest(res, 'A campus with this name already exists');
  }
  if (dupes.some((c) => c.code === code)) return badRequest(res, 'A campus with this code already exists');

  const campus = await campusModel.create(data);
  logAudit(req, 'CREATE', 'Campus', campus.id, `Created campus "${campus.name}" (${campus.code})`);
  return created(res, campus);
}

// Work that would become unreachable for a campus's staff once it is inactive
// (requireLibraryAccess denies them). Returns human-readable parts; [] when clear.
async function openCampusWork(campusId) {
  const campusOid = new mongoose.Types.ObjectId(String(campusId));
  const [batches, staff, openLoans, openCharges, openChecks] = await Promise.all([
    campusModel.countActiveBatches(campusId),
    campusModel.countActiveStaff(campusId),
    Loan.countDocuments({ campusId: campusOid, status: 'OPEN' }),
    Charge.countDocuments({ campusId: campusOid, status: { $in: ['UNPAID', 'PARTIAL'] } }),
    StockCheck.countDocuments({ campusId: campusOid, status: 'OPEN' }),
  ]);
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const parts = [];
  if (batches > 0) parts.push(n(batches, 'active batch', 'active batches'));
  if (staff > 0) parts.push(n(staff, 'active staff member', 'active staff members'));
  if (openLoans > 0) parts.push(n(openLoans, 'book still issued', 'books still issued'));
  if (openCharges > 0) parts.push(n(openCharges, 'unpaid library charge', 'unpaid library charges'));
  if (openChecks > 0) parts.push(n(openChecks, 'open stock check', 'open stock checks'));
  return parts;
}

async function updateCampus(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return notFound(res, 'Campus not found');
  const existing = await campusModel.findById(req.params.id);
  if (!existing) return notFound(res, 'Campus not found');
  const body = req.body || {};

  if (body.code !== undefined) {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : null;
    if (code !== existing.code) return badRequest(res, 'Campus code cannot be changed');
  }

  const data = {};
  if (body.name !== undefined) {
    const nameErr = validName(body.name);
    if (nameErr) return badRequest(res, nameErr);
    data.name = body.name.trim();
  }
  const fieldErr = collectFields(body, data);
  if (fieldErr) return badRequest(res, fieldErr);
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') return badRequest(res, 'isActive must be a boolean');
    data.isActive = body.isActive;
  }
  if (Object.keys(data).length === 0) return badRequest(res, 'No fields to update');

  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dupes = await campusModel.findByNameOrCode({ name: data.name, excludeId: existing.id });
    if (dupes.length) return badRequest(res, 'A campus with this name already exists');
  }

  const deactivating = data.isActive === false && existing.isActive;
  const blockedMsg = (parts) =>
    `Cannot deactivate campus "${existing.name}": it still has ${parts.join(', ')}. Resolve them first.`;
  if (deactivating) {
    const parts = await openCampusWork(existing.id);
    if (parts.length) return badRequest(res, blockedMsg(parts));
  }

  const updated = await campusModel.update(existing.id, data);

  if (deactivating) {
    // Close the check-then-update race: once the campus is inactive, requireLibraryAccess
    // stops new staff requests, so re-check now to catch anything (a loan issued, a charge
    // raised…) committed between the first check and the update, and roll back if so.
    const parts = await openCampusWork(existing.id);
    if (parts.length) {
      const revert = { isActive: true };
      for (const k of Object.keys(data)) if (k !== 'isActive') revert[k] = existing[k] === undefined ? '' : existing[k];
      await campusModel.update(existing.id, revert);
      return badRequest(res, blockedMsg(parts));
    }
  }

  const changes = [];
  if (data.name !== undefined && data.name !== existing.name) changes.push(`name "${existing.name}" -> "${data.name}"`);
  for (const f of TEXT_FIELDS) {
    if (data[f] !== undefined && data[f] !== (existing[f] || '')) changes.push(`${f} updated`);
  }
  for (const f of LIST_FIELDS) {
    if (data[f] !== undefined && JSON.stringify(data[f]) !== JSON.stringify(existing[f])) {
      changes.push(`${f} updated (${existing[f].length} -> ${data[f].length} entries)`);
    }
  }
  if (data.isActive !== undefined && data.isActive !== existing.isActive) {
    changes.push(data.isActive ? 'reactivated' : 'deactivated');
  }
  logAudit(req, 'UPDATE', 'Campus', existing.id,
    `Updated campus "${existing.name}" (${existing.code}): ${changes.join(', ') || 'no changes'}`);
  return ok(res, updated);
}

// Library rules (single global document)
const SETTING_RULES = {
  loanDays:           { label: 'Loan days',            int: true,  min: 1, max: 365 },
  finePerDay:         { label: 'Fine per day',         int: false, min: 0 },
  maxBooks:           { label: 'Max books',            int: true,  min: 1, max: 20 },
  maxRenewals:        { label: 'Max renewals',         int: true,  min: 0, max: 10 },
  fineBlockThreshold: { label: 'Fine block threshold', int: false, min: 0 },
};

async function getSettings(req, res) {
  return ok(res, await librarySettingsModel.get());
}

async function updateSettings(req, res) {
  const body = req.body || {};
  const data = {};
  for (const [key, rule] of Object.entries(SETTING_RULES)) {
    if (body[key] === undefined) continue;
    const v = body[key];
    if (typeof v !== 'number' && (typeof v !== 'string' || !v.trim())) return badRequest(res, `${rule.label} must be a number`);
    const n = Number(v);
    if (!Number.isFinite(n)) return badRequest(res, `${rule.label} must be a number`);
    if (rule.int && !Number.isInteger(n)) return badRequest(res, `${rule.label} must be a whole number`);
    if (n < rule.min || (rule.max !== undefined && n > rule.max)) {
      return badRequest(res, rule.max !== undefined
        ? `${rule.label} must be between ${rule.min} and ${rule.max}`
        : `${rule.label} must be ${rule.min} or more`);
    }
    data[key] = n;
  }
  if (Object.keys(data).length === 0) return badRequest(res, 'No fields to update');

  const before = await librarySettingsModel.get();
  const updated = await librarySettingsModel.update(data);
  const changes = Object.keys(data)
    .filter((k) => data[k] !== before[k])
    .map((k) => `${SETTING_RULES[k].label} ${before[k]} -> ${data[k]}`);
  logAudit(req, 'UPDATE', 'LibrarySettings', updated.id,
    `Updated library settings: ${changes.join(', ') || 'no changes'}`);
  return ok(res, updated);
}

module.exports = { listCampuses, createCampus, updateCampus, getSettings, updateSettings };
