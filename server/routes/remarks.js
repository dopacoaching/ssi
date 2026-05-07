const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/remarkController');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/students/:id/remarks',                  verifyToken, asyncHandler(ctrl.list));
router.post('/students/:id/remarks',                 verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.add));
router.patch('/students/:id/remarks/:remarkId/flag', verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.flag));

module.exports = router;
