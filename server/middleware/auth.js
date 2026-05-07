const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('../views/response');

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
      return forbidden(res, 'Insufficient permissions');
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };
