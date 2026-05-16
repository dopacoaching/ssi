const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('../views/response');
const { logError } = require('../utils/audit');

function verifyToken(req, res, next) {
  const token = req.cookies?.accessToken;
  if (!token) return unauthorized(res, 'Not authenticated');

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return unauthorized(res, 'Invalid or expired token');
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      logError(req, 403, `Role "${req.user?.role}" attempted to access route restricted to [${roles.join(', ')}] — ${req.method} ${req.originalUrl}`);
      return forbidden(res, 'Insufficient permissions');
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };
