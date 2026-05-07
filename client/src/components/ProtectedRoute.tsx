import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store';

interface Props {
  children: React.ReactNode;
  role?: 'ADMIN' | 'TEACHER' | 'STUDENT' | ('ADMIN' | 'TEACHER' | 'STUDENT')[];
}

export default function ProtectedRoute({ children, role }: Props) {
  const { user, checked } = useSelector((s: RootState) => s.auth);

  if (!checked) return <div className="flex h-screen items-center justify-center text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900 text-sm">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
