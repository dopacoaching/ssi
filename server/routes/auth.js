const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { login, refresh, logout } = require('../controllers/authController');
const asyncHandler = require('../middleware/asyncHandler');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again later' },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

router.post('/login',   loginLimiter,   asyncHandler(login));
router.post('/refresh', refreshLimiter, asyncHandler(refresh));
router.post('/logout',  logout);

module.exports = router;
