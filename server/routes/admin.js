const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');
const campusCtrl = require('../controllers/campusController');
const staffCtrl = require('../controllers/staffController');
const auditCtrl = require('../controllers/auditController');
const asyncHandler = require('../middleware/asyncHandler');

const admin = [verifyToken, requireRole('ADMIN')];

router.get('/batches',       ...admin, asyncHandler(ctrl.listBatches));
router.post('/batches',      ...admin, asyncHandler(ctrl.createBatch));
router.patch('/batches/:id', ...admin, asyncHandler(ctrl.updateBatch));

router.get('/teachers',       ...admin, asyncHandler(ctrl.listTeachers));
router.post('/teachers',      ...admin, asyncHandler(ctrl.createTeacher));
router.patch('/teachers/:id', ...admin, asyncHandler(ctrl.updateTeacher));

router.get('/staff',       ...admin, asyncHandler(staffCtrl.listStaff));
router.post('/staff',      ...admin, asyncHandler(staffCtrl.createStaff));
router.patch('/staff/:id', ...admin, asyncHandler(staffCtrl.updateStaff));

router.get('/campuses',       ...admin, asyncHandler(campusCtrl.listCampuses));
router.post('/campuses',      ...admin, asyncHandler(campusCtrl.createCampus));
router.patch('/campuses/:id', ...admin, asyncHandler(campusCtrl.updateCampus));

router.get('/library-settings',   ...admin, asyncHandler(campusCtrl.getSettings));
router.patch('/library-settings', ...admin, asyncHandler(campusCtrl.updateSettings));

router.get('/students',              ...admin, asyncHandler(ctrl.listAllStudents));
router.get('/batches/:id/analytics', verifyToken, requireRole('ADMIN', 'TEACHER'), asyncHandler(ctrl.batchAnalytics));
router.get('/alerts',                verifyToken, requireRole('ADMIN', 'TEACHER'), asyncHandler(ctrl.alerts));

router.get('/batches/:id/approvals',  verifyToken, requireRole('ADMIN', 'TEACHER'), asyncHandler(ctrl.listBatchApprovals));
router.post('/batches/:id/approvals', ...admin, asyncHandler(ctrl.toggleBatchApproval));

router.get('/batches/:id/working-days',  verifyToken, requireRole('ADMIN', 'TEACHER'), asyncHandler(ctrl.listBatchWorkingDays));
router.post('/batches/:id/working-days', verifyToken, requireRole('ADMIN', 'TEACHER'), asyncHandler(ctrl.setBatchWorkingDays));

router.post('/batches/transfer',          ...admin, asyncHandler(ctrl.transferStudents));

router.get('/audit', ...admin, asyncHandler(auditCtrl.list));

module.exports = router;
