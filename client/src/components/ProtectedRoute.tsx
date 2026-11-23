import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store';

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'LIBRARIAN';

interface Props {
  children: React.ReactNode;
  role?: Role | Role[];
  /** Library routes: allowed for ADMIN or any user with a library campus. */
  libraryAccess?: boolean;
}

export default function ProtectedRoute({ children, role, libraryAccess }: Props) {
  const { user, checked } = useSelector((s: RootState) => s.auth);

  if (!checked) return <div className="flex h-screen items-center justify-center text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900 text-sm">Loading…</div>;
  if (!user) {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    return <Navigate to={standalone ? '/student/login' : '/login'} replace />;
  }

  if (libraryAccess) {
    if (user.role !== 'ADMIN' && !user.libraryCampusId) {
      // A librarian without a campus would bounce between "/" and "/library" forever.
      if (user.role === 'LIBRARIAN') {
        return (
          <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900 px-4">
            <div className="max-w-sm text-center">
              <p className="text-base font-semibold text-gray-800 dark:text-gray-100">No library assigned</p>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Your account is not linked to a campus library yet. Please contact the admin.
              </p>
            </div>
          </div>
        );
      }
      return <Navigate to="/" replace />;
    }
    if (role) {
      const roles = Array.isArray(role) ? role : [role];
      if (!roles.includes(user.role)) return <Navigate to="/library" replace />;
    }
    return <>{children}</>;
  }

  // Librarians may only ever see the library section.
  if (user.role === 'LIBRARIAN') return <Navigate to="/library" replace />;

  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
