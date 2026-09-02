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
const Teachers      = lazy(() => import('../pages/admin/Teachers'));
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
  {
    path: '/admin/teachers',
    element: <ProtectedRoute role="ADMIN"><Teachers /></ProtectedRoute>,
  },
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
