const jwt = require('jsonwebtoken');
const { mongoose } = require('../utils/db');
const { User } = require('../models/schemas');
const campusModel = require('../models/campusModel');
const { forbidden } = require('../views/response');
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

// App-level guard for the non-library /api routers: if the access-token cookie is
// a valid LIBRARIAN token, return 403; anything else (no/invalid token, other
// roles) passes through untouched so existing behaviour is unchanged.
function blockLibrarian(req, res, next) {
  const token = req.cookies?.accessToken;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload?.role === 'LIBRARIAN') {
        req.user = payload;
        logError(req, 403, `Library staff blocked — ${req.method} ${req.originalUrl}`);
        return forbidden(res, LIBRARIAN_DENIED);
      }
    } catch { /* invalid/expired — let the route's own auth handle it */ }
  }
  next();
}

module.exports = { requireLibraryAccess, campusFilter, assertCampusAccess, denyRole, blockLibrarian };
