const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');
const auditCtrl = require('../controllers/auditController');
const asyncHandler = require('../middleware/asyncHandler');

const admin = [verifyToken, requireRole('ADMIN')];

router.get('/batches',       ...admin, asyncHandler(ctrl.listBatches));
router.post('/batches',      ...admin, asyncHandler(ctrl.createBatch));
router.patch('/batches/:id', ...admin, asyncHandler(ctrl.updateBatch));

router.get('/teachers',       ...admin, asyncHandler(ctrl.listTeachers));
router.post('/teachers',      ...admin, asyncHandler(ctrl.createTeacher));
router.patch('/teachers/:id', ...admin, asyncHandler(ctrl.updateTeacher));

router.get('/students',              ...admin, asyncHandler(ctrl.listAllStudents));
router.get('/batches/:id/analytics', verifyToken, requireRole('ADMIN', 'TEACHER'), asyncHandler(ctrl.batchAnalytics));
router.get('/alerts',                verifyToken, requireRole('ADMIN', 'TEACHER'), asyncHandler(ctrl.alerts));

router.get('/batches/:id/approvals',  verifyToken, requireRole('ADMIN', 'TEACHER'), asyncHandler(ctrl.listBatchApprovals));
router.post('/batches/:id/approvals', ...admin, asyncHandler(ctrl.toggleBatchApproval));
router.post('/batches/transfer',          ...admin, asyncHandler(ctrl.transferStudents));

router.get('/audit', ...admin, asyncHandler(auditCtrl.list));

module.exports = router;
