const router = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const { requireLibraryAccess } = require('../middleware/libraryScope');
const ctrl = require('../controllers/libraryController');
const catalog = require('../controllers/catalogController');
const circulation = require('../controllers/circulationController');
const fines = require('../controllers/finesController');
const clearance = require('../controllers/clearanceController');
const dashboard = require('../controllers/dashboardController');
const reports = require('../controllers/reportsController');
const stockCheck = require('../controllers/stockCheckController');
const asyncHandler = require('../middleware/asyncHandler');

const library = [verifyToken, requireLibraryAccess];

router.get('/me',                              ...library, asyncHandler(ctrl.me));
router.get('/campuses',                        ...library, asyncHandler(ctrl.listCampuses));
router.patch('/campuses/:id/catalog-settings', ...library, asyncHandler(ctrl.updateCatalogSettings));

// Catalog (Phase 2). Static paths (/books/similar, /books/bulk/*) are registered before /books/:id.
router.get('/books',                  ...library, asyncHandler(catalog.listBooks));
router.get('/books/similar',          ...library, asyncHandler(catalog.similarBooks));
router.post('/books/bulk/validate',   ...library, asyncHandler(catalog.bulkValidate));
router.post('/books/bulk/import',     ...library, asyncHandler(catalog.bulkImport));
router.post('/books',                 ...library, asyncHandler(catalog.createBook));
router.get('/books/:id',              ...library, asyncHandler(catalog.getBook));
router.patch('/books/:id',            ...library, asyncHandler(catalog.updateBook));
router.post('/books/:id/copies',      ...library, asyncHandler(catalog.addCopies));
router.patch('/copies/:id',           ...library, asyncHandler(catalog.updateCopy));
router.post('/copies/:id/withdraw',   ...library, asyncHandler(catalog.withdrawCopy));
router.post('/copies/:id/reinstate',  ...library, asyncHandler(catalog.reinstateCopy));
router.post('/copies/:id/found',      ...library, asyncHandler(catalog.markFound));
router.post('/copies/:id/repair',     ...library, asyncHandler(catalog.markRepaired));

// Circulation (Phase 3)
router.get('/circulation/student/:regNumber',        ...library, asyncHandler(circulation.studentCard));
router.get('/circulation/copy/:catalogNumber',       ...library, asyncHandler(circulation.copyCard));
router.get('/circulation/loans',                     ...library, asyncHandler(circulation.listLoans));
router.get('/circulation/students/:studentId/history', ...library, asyncHandler(circulation.studentHistory));
router.post('/circulation/issue',                    ...library, asyncHandler(circulation.issue));
router.post('/circulation/return',                   ...library, asyncHandler(circulation.returnBook));
router.post('/circulation/report-lost',              ...library, asyncHandler(circulation.reportLost));
router.post('/circulation/renew',                    ...library, asyncHandler(circulation.renew));

// Fines & payments (Phase 4). Static paths (/payments/summary, /fine-periods/preview) come before /:id.
router.get('/fines/pending',                  ...library, asyncHandler(fines.pending));
router.get('/fines/students/:studentId',      ...library, asyncHandler(fines.studentFines));
router.get('/payments/summary',               ...library, asyncHandler(fines.paymentSummary));
router.get('/payments',                       ...library, asyncHandler(fines.listPayments));
router.post('/payments',                      ...library, asyncHandler(fines.createPayment));
router.get('/payments/:id',                   ...library, asyncHandler(fines.getPayment));
router.post('/payments/:id/void',             ...library, asyncHandler(fines.voidPayment));
router.get('/waivers',                        ...library, asyncHandler(fines.listWaivers));
router.post('/waivers',                       ...library, asyncHandler(fines.requestWaiver));
router.post('/waivers/:id/approve',           ...library, asyncHandler(fines.approveWaiver));
router.post('/waivers/:id/reject',            ...library, asyncHandler(fines.rejectWaiver));
router.get('/fine-periods',                   ...library, asyncHandler(fines.listFinePeriods));
router.get('/fine-periods/preview',           ...library, asyncHandler(fines.previewFinePeriod));
router.post('/fine-periods',                  ...library, asyncHandler(fines.createFinePeriod));
router.post('/fine-periods/:id/cancel',       ...library, asyncHandler(fines.cancelFinePeriod));

// Phase 5: No-Dues, dashboard, reports, stock check. Static paths before parameterised ones.
router.get('/clearance/:regNumber',           ...library, asyncHandler(clearance.check));
router.post('/clearance/:regNumber/slip',     ...library, asyncHandler(clearance.slip));
router.get('/dashboard',                      ...library, asyncHandler(dashboard.dashboard));
router.get('/reports/:type',                  ...library, asyncHandler(reports.run));
router.get('/stock-checks',                   ...library, asyncHandler(stockCheck.list));
router.post('/stock-checks',                  ...library, asyncHandler(stockCheck.start));
router.get('/stock-checks/:id',               ...library, asyncHandler(stockCheck.getOne));
router.post('/stock-checks/:id/scan',         ...library, asyncHandler(stockCheck.scan));
router.delete('/stock-checks/:id/scans/:copyId', ...library, asyncHandler(stockCheck.undoScan));
router.post('/stock-checks/:id/close',        ...library, asyncHandler(stockCheck.close));
router.post('/stock-checks/:id/cancel',       ...library, asyncHandler(stockCheck.cancel));
router.post('/stock-checks/:id/mark-lost',    ...library, asyncHandler(stockCheck.markLost));

module.exports = router;
