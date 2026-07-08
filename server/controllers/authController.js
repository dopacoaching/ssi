const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const studentModel = require('../models/studentModel');
const { ok, badRequest, unauthorized } = require('../views/response');
const { logAudit, logFailedLogin } = require('../utils/audit');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
};

const SESSION_FLAG_OPTS = {
  httpOnly: false,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function signTokens(u) {
  const payload = { 
    id: u.id, 
    role: u.role || 'STUDENT', 
    name: u.name || u.fullName, 
    batchIds: u.batchIds || (u.batchId ? [u.batchId] : [])
  };
  const accessToken  = jwt.sign(payload, process.env.JWT_SECRET,         { expiresIn: '15m' });
  const refreshToken = jwt.sign({ id: u.id, isStudent: !u.role || u.role === 'STUDENT' }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

async function login(req, res) {
  // Trim surrounding whitespace so a stray space in the email/reg number
  // doesn't cause a false "account not found".
  const email     = (req.body.email     || '').trim();
  const regNumber = (req.body.regNumber || '').trim();
  const { password } = req.body;
  if ((!email && !regNumber) || !password) return badRequest(res, 'Credentials and password required');

  let account = null;
  if (email) {
    account = await userModel.findByEmail(email);
  } else if (regNumber) {
    account = await studentModel.findByRegNumber(regNumber);
  }

  if (!account) {
    logFailedLogin(email || regNumber, 'Account not found');
    return unauthorized(res, 'Invalid credentials');
  }
  if (!account.isActive) {
    logFailedLogin(email || regNumber, 'Account is inactive');
    return unauthorized(res, 'Invalid credentials');
  }
  if (!account.password) {
    logFailedLogin(email || regNumber, 'No password set');
    return unauthorized(res, 'Invalid credentials');
  }

  const match = await bcrypt.compare(password, account.password);
  if (!match) {
    logFailedLogin(email || regNumber, 'Wrong password');
    return unauthorized(res, 'Invalid credentials');
  }

  const { accessToken, refreshToken } = signTokens(account);

  res.cookie('accessToken',  accessToken,  { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.cookie('sessionExists', '1', SESSION_FLAG_OPTS);

  // Audit successful login
  const auditUser = {
    id:   account.id,
    name: account.name || account.fullName,
    role: account.role || 'STUDENT'
  };
  const entityType = account.role ? 'User' : 'Student';
  logAudit({ user: auditUser }, 'LOGIN', entityType, account.id, `${auditUser.name} logged in`);

  return ok(res, { 
    id: account.id, 
    name: account.name || account.fullName, 
    role: account.role || 'STUDENT', 
    batchIds: account.batchIds || (account.batchId ? [account.batchId] : []) 
  });
}

async function refresh(req, res) {
  const token = req.cookies?.refreshToken;
  if (!token) return unauthorized(res, 'No refresh token');

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (_) {
    return unauthorized(res, 'Invalid refresh token');
  }

  let account = null;
  if (payload.isStudent) {
    account = await studentModel.findById(payload.id);
  } else {
    account = await userModel.findById(payload.id);
  }
  
  if (!account || !account.isActive) return unauthorized(res, 'Account not found');

  const { accessToken, refreshToken } = signTokens(account);
  res.cookie('accessToken',  accessToken,  { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.cookie('sessionExists', '1', SESSION_FLAG_OPTS);

  return ok(res, { 
    id: account.id, 
    name: account.name || account.fullName, 
    role: account.role || 'STUDENT', 
    batchIds: account.batchIds || (account.batchId ? [account.batchId] : []) 
  });
}

function logout(req, res) {
  res.clearCookie('accessToken',  COOKIE_OPTS);
  res.clearCookie('refreshToken', COOKIE_OPTS);
  res.clearCookie('sessionExists', { sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
  return ok(res, null, 'Logged out');
}

module.exports = { login, refresh, logout };
