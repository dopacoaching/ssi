const mongoose = require('mongoose');
const campusModel = require('../models/campusModel');
const librarySettingsModel = require('../models/librarySettingsModel');
const { assertCampusAccess } = require('../middleware/libraryScope');
const { cleanStringList } = require('../utils/validation');
const { logAudit, logError } = require('../utils/audit');
const { ok, badRequest, forbidden, notFound } = require('../views/response');

async function me(req, res) {
  const { isAdmin, campusId } = req.library;
  const [settings, campuses] = await Promise.all([
    librarySettingsModel.get(),
    isAdmin
      ? campusModel.findAll()
      : campusModel.findById(campusId).then((c) => (c && c.isActive ? [c] : [])),
  ]);
  return ok(res, {
    isAdmin,
    campus: isAdmin ? null : (campuses[0] || null),
    campuses,
    settings,
  });
}

async function listCampuses(req, res) {
  const { isAdmin, campusId } = req.library;
  const campuses = isAdmin
    ? await campusModel.findAll()
    : await campusModel.findById(campusId).then((c) => (c && c.isActive ? [c] : []));
  return ok(res, campuses);
}

async function updateCatalogSettings(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return notFound(res, 'Campus not found');
  if (!assertCampusAccess(req, id)) {
    logError(req, 403, `Library user attempted to edit another campus (${id}) — ${req.method} ${req.originalUrl}`);
    return forbidden(res, 'You can only manage your own campus');
  }
  const existing = await campusModel.findById(id);
  if (!existing || !existing.isActive) return notFound(res, 'Campus not found');

  const body = req.body || {};
  const data = {};
  for (const f of ['shelfLocations', 'categories']) {
    if (body[f] === undefined) continue;
    const r = cleanStringList(body[f], f);
    if (r.error) return badRequest(res, r.error);
    data[f] = r.value;
  }
  if (Object.keys(data).length === 0) return badRequest(res, 'No fields to update');

  const updated = await campusModel.update(id, data);
  const changes = Object.keys(data)
    .filter((f) => JSON.stringify(data[f]) !== JSON.stringify(existing[f]))
    .map((f) => `${f} updated (${existing[f].length} -> ${data[f].length} entries)`);
  logAudit(req, 'UPDATE', 'Campus', id,
    `Updated catalog settings for campus "${existing.name}": ${changes.join(', ') || 'no changes'}`);
  return ok(res, updated);
}

module.exports = { me, listCampuses, updateCatalogSettings };
