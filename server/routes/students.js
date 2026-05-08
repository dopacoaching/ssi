const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/studentController');
const batchCtrl = require('../controllers/batchController');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/batches',                   verifyToken, asyncHandler(batchCtrl.listBatches));
router.get('/batches/:batchId/students', verifyToken, asyncHandler(ctrl.listByBatch));
router.get('/batches/:batchId/report',   verifyToken, asyncHandler(ctrl.batchReport));
router.post('/students',                 verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.create));
router.get('/students/search',           verifyToken, asyncHandler(ctrl.search));
router.get('/students/:id',              verifyToken, asyncHandler(ctrl.getOne));
router.patch('/students/:id',            verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.update));
router.patch('/students/:id/photo',      verifyToken, requireRole('ADMIN', 'TEACHER'), asyncHandler(ctrl.updatePhoto));
router.delete('/students/:id',           verifyToken, requireRole('TEACHER'), asyncHandler(ctrl.remove));

module.exports = router;
