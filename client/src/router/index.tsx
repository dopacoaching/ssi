import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import ProtectedRoute from '../components/ProtectedRoute';
import Login from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import StudentLogin from '../pages/StudentLogin';

const Students      = lazy(() => import('../pages/Students'));
const StudentDetail = lazy(() => import('../pages/StudentDetail'));
const Batches       = lazy(() => import('../pages/admin/Batches'));
const Staff         = lazy(() => import('../pages/admin/Staff'));
const Campuses      = lazy(() => import('../pages/admin/Campuses'));
const LibraryDashboard = lazy(() => import('../pages/library/LibraryDashboard'));
const LibrarySettings  = lazy(() => import('../pages/library/LibrarySettings'));
const Catalog          = lazy(() => import('../pages/library/Catalog'));
const AddBook          = lazy(() => import('../pages/library/AddBook'));
const BookDetail       = lazy(() => import('../pages/library/BookDetail'));
const BulkUpload       = lazy(() => import('../pages/library/BulkUpload'));
const Desk             = lazy(() => import('../pages/library/Desk'));
const Overdue          = lazy(() => import('../pages/library/Overdue'));
const StudentLibrary   = lazy(() => import('../pages/library/StudentLibrary'));
const Fines            = lazy(() => import('../pages/library/Fines'));
const Payments         = lazy(() => import('../pages/library/Payments'));
const Waivers          = lazy(() => import('../pages/library/Waivers'));
const FinePeriods      = lazy(() => import('../pages/library/FinePeriods'));
const Reports          = lazy(() => import('../pages/library/Reports'));
const StockCheck       = lazy(() => import('../pages/library/StockCheck'));
const StockCheckDetail = lazy(() => import('../pages/library/StockCheckDetail'));
const Clearance        = lazy(() => import('../pages/library/Clearance'));
const BatchTestEntry  = lazy(() => import('../pages/BatchTestEntry'));
const ProgressReport   = lazy(() => import('../pages/ProgressReport'));
const BatchAnalytics  = lazy(() => import('../pages/admin/BatchAnalytics'));
const AuditLog        = lazy(() => import('../pages/admin/AuditLog'));

const PageFallback = (
  <div className="flex h-screen items-center justify-center text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900 text-sm">
    Loading…
  </div>
);

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/student/login', element: <StudentLogin /> },
  {
    path: '/',
    element: <ProtectedRoute><Dashboard /></ProtectedRoute>,
  },
  {
    path: '/students',
    element: <ProtectedRoute role={['ADMIN', 'TEACHER'] as any}><Students /></ProtectedRoute>,
  },
  {
    path: '/students/:id',
    element: <ProtectedRoute><StudentDetail /></ProtectedRoute>,
  },
  {
    path: '/students/:id/progress-report',
    element: <ProtectedRoute role={['ADMIN', 'TEACHER']}><ProgressReport /></ProtectedRoute>,
  },
  {
    path: '/admin/batches',
    element: <ProtectedRoute role="ADMIN"><Batches /></ProtectedRoute>,
  },
  { path: '/admin/teachers', element: <Navigate to="/admin/staff" replace /> },
  {
    path: '/admin/staff',
    element: <ProtectedRoute role="ADMIN"><Staff /></ProtectedRoute>,
  },
  {
    path: '/admin/campuses',
    element: <ProtectedRoute role="ADMIN"><Campuses /></ProtectedRoute>,
  },
  {
    path: '/library',
    element: <ProtectedRoute libraryAccess><LibraryDashboard /></ProtectedRoute>,
  },
  {
    path: '/library/settings',
    element: <ProtectedRoute libraryAccess><LibrarySettings /></ProtectedRoute>,
  },
  { path: '/library/catalog', element: <ProtectedRoute libraryAccess><Catalog /></ProtectedRoute> },
  { path: '/library/catalog/new', element: <ProtectedRoute libraryAccess><AddBook /></ProtectedRoute> },
  { path: '/library/catalog/upload', element: <ProtectedRoute libraryAccess><BulkUpload /></ProtectedRoute> },
  { path: '/library/desk', element: <ProtectedRoute libraryAccess><Desk /></ProtectedRoute> },
  { path: '/library/overdue', element: <ProtectedRoute libraryAccess><Overdue /></ProtectedRoute> },
  { path: '/library/fines', element: <ProtectedRoute libraryAccess><Fines /></ProtectedRoute> },
  { path: '/library/payments', element: <ProtectedRoute libraryAccess><Payments /></ProtectedRoute> },
  { path: '/library/waivers', element: <ProtectedRoute libraryAccess><Waivers /></ProtectedRoute> },
  { path: '/library/reports', element: <ProtectedRoute libraryAccess><Reports /></ProtectedRoute> },
  { path: '/library/stock-check', element: <ProtectedRoute libraryAccess><StockCheck /></ProtectedRoute> },
  { path: '/library/stock-check/:id', element: <ProtectedRoute libraryAccess><StockCheckDetail /></ProtectedRoute> },
  { path: '/library/clearance', element: <ProtectedRoute libraryAccess><Clearance /></ProtectedRoute> },
  { path: '/library/fine-periods', element: <ProtectedRoute libraryAccess role="ADMIN"><FinePeriods /></ProtectedRoute> },
  { path: '/library/students/:regNumber', element: <ProtectedRoute libraryAccess><StudentLibrary /></ProtectedRoute> },
  { path: '/library/books/:id', element: <ProtectedRoute libraryAccess><BookDetail /></ProtectedRoute> },
  {
    path: '/batch-test-entry',
    element: <ProtectedRoute role="TEACHER"><BatchTestEntry /></ProtectedRoute>,
  },
  {
    path: '/analytics',
    element: <ProtectedRoute role={['ADMIN', 'TEACHER'] as any}><BatchAnalytics /></ProtectedRoute>,
  },
  {
    path: '/admin/audit',
    element: <ProtectedRoute role="ADMIN"><AuditLog /></ProtectedRoute>,
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function AppRouter() {
  const { restore } = useAuth();
  const checked = useSelector((s: RootState) => s.auth.checked);

  useEffect(() => {
    restore().catch(() => {});
  }, [restore]);

  if (!checked) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900 text-sm">
        Loading…
      </div>
    );
  }

  return <Suspense fallback={PageFallback}><RouterProvider router={router} future={{ v7_startTransition: true }} /></Suspense>;
}
