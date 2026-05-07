const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/testController');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/students/:id/weekly-tests',   verifyToken, asyncHandler(ctrl.listWeekly));
router.post('/students/:id/weekly-tests',  verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.addWeekly));
router.patch('/weekly-tests/:testId',      verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.updateWeekly));
router.delete('/weekly-tests/:testId',     verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.deleteWeekly));

router.get('/students/:id/monthly-tests',  verifyToken, asyncHandler(ctrl.listMonthly));
router.post('/students/:id/monthly-tests', verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.addMonthly));
router.patch('/monthly-tests/:testId',     verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.updateMonthly));
router.delete('/monthly-tests/:testId',    verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.deleteMonthly));

router.post('/batches/:batchId/tests/bulk', verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.bulkAdd));

module.exports = router;
