const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/ceController');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/students/:id/ce',  verifyToken, asyncHandler(ctrl.list));
router.post('/students/:id/ce', verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.upsert));
router.delete('/students/:id/ce/:ceId', verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.remove));

module.exports = router;
