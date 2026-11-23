const jwt = require('jsonwebtoken');
const { mongoose } = require('../utils/db');
const { User } = require('../models/schemas');
const campusModel = require('../models/campusModel');
const { forbidden, unauthorized } = require('../views/response');
const { logError } = require('../utils/audit');

const LIBRARIAN_DENIED = 'Library staff cannot access this resource';

// Use after verifyToken. Re-reads the user (fresh, not from the JWT) so a
// deactivated account / campus or a changed assignment takes effect immediately.
// Sets req.library = { isAdmin, campusId } (campusId null for admin).
async function requireLibraryAccess(req, res, next) {
  try {
    const user = await User.findById(req.user?.id).select('role isActive libraryCampusId').lean();
    if (!user || !user.isActive) {
      logError(req, 403, `Library access denied (account missing or inactive) — ${req.method} ${req.originalUrl}`);
      return forbidden(res, 'Library access denied');
    }
    if (user.role === 'ADMIN') {
      req.library = { isAdmin: true, campusId: null };
      return next();
    }
    if (!user.libraryCampusId) {
      logError(req, 403, `Library access denied (no library campus assigned) — ${req.method} ${req.originalUrl}`);
      return forbidden(res, 'Library access denied');
    }
    const campus = await campusModel.findById(user.libraryCampusId);
    if (!campus || !campus.isActive) {
      logError(req, 403, `Library access denied (campus missing or inactive) — ${req.method} ${req.originalUrl}`);
      return forbidden(res, 'Library access denied');
    }
    req.library = { isAdmin: false, campusId: String(user.libraryCampusId) };
    return next();
  } catch (err) {
    return next(err);
  }
}

// {} for admin, { campusId: ObjectId } for everyone else. Spread into queries.
function campusFilter(req) {
  if (req.library?.isAdmin) return {};
  return { campusId: new mongoose.Types.ObjectId(req.library.campusId) };
}

// true when the caller may act on the given campus.
function assertCampusAccess(req, campusId) {
  if (req.library?.isAdmin) return true;
  return !!req.library?.campusId && String(campusId) === String(req.library.campusId);
}

// Route-level guard (needs req.user, i.e. after verifyToken).
function denyRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user?.role)) {
      logError(req, 403, `Role "${req.user.role}" blocked — ${req.method} ${req.originalUrl}`);
      return forbidden(res, LIBRARIAN_DENIED);
    }
    next();
  };
}

// Short per-instance cache of DB roles for blockLibrarian, so a burst of teacher requests
// costs one lookup, not one per request. Role changes still apply within ROLE_CACHE_MS.
const ROLE_CACHE_MS = 10 * 1000;
const ROLE_CACHE_MAX = 1000;
const roleCache = new Map(); // userId -> { role, at }

async function currentRole(userId) {
  const hit = roleCache.get(userId);
  if (hit && Date.now() - hit.at < ROLE_CACHE_MS) return hit.role;
  const user = await User.findById(userId).select('role').lean();
  const role = user ? user.role : null;
  if (roleCache.size >= ROLE_CACHE_MAX) roleCache.clear();
  roleCache.set(userId, { role, at: Date.now() });
  return role;
}

// App-level guard for the non-library /api routers: if the access-token cookie is
// a valid LIBRARIAN token, return 403; anything else (no/invalid token, other
// roles) passes through untouched so existing behaviour is unchanged.
// TEACHER and LIBRARIAN tokens are re-checked against the DB role (cached briefly):
//  - DB role LIBRARIAN            -> 403 (covers a fresh TEACHER -> LIBRARIAN change)
//  - DB role differs from token   -> 401, so the client refreshes its token (the refresh
//                                    re-reads the role) and retries (covers LIBRARIAN -> TEACHER)
// If the lookup fails, the token's own role is used; a DB blip never turns into a 500 here.
async function blockLibrarian(req, res, next) {
  const token = req.cookies?.accessToken;
  if (!token) return next();
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next();   // invalid/expired — let the route's own auth handle it
  }
  const tokenRole = payload?.role;
  let role = tokenRole;
  if ((tokenRole === 'TEACHER' || tokenRole === 'LIBRARIAN') && payload.id && mongoose.isValidObjectId(payload.id)) {
    try {
      const dbRole = await currentRole(String(payload.id));
      if (dbRole) role = dbRole;
    } catch (err) {
      console.error('[blockLibrarian] role lookup failed, using token role', err.message);
    }
  }
  if (role === 'LIBRARIAN') {
    req.user = payload;
    logError(req, 403, `Library staff blocked — ${req.method} ${req.originalUrl}`);
    return forbidden(res, LIBRARIAN_DENIED);
  }
  if (role !== tokenRole) return unauthorized(res, 'Your role has changed — session needs refreshing');
  return next();
}

module.exports = { requireLibraryAccess, campusFilter, assertCampusAccess, denyRole, blockLibrarian };
