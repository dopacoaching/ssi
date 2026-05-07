const router = require('express').Router();
const { login, refresh, logout } = require('../controllers/authController');
const asyncHandler = require('../middleware/asyncHandler');

router.post('/login',   asyncHandler(login));
router.post('/refresh', asyncHandler(refresh));
router.post('/logout',  logout);

module.exports = router;
