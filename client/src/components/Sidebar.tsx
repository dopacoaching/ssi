import { NavLink } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store';

interface Props { onClose?: () => void }

const link = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
    isActive
      ? 'bg-white/20 text-white'
      : 'text-indigo-100 hover:bg-white/10 hover:text-white'
  }`;

export default function Sidebar({ onClose }: Props) {
  const user = useSelector((s: RootState) => s.auth.user);

  return (
    <aside className="w-64 h-full flex-shrink-0 bg-indigo-800 flex flex-col py-5 px-3 overflow-y-auto">
      <p className="px-3 mb-3 text-xs uppercase tracking-widest text-indigo-300/60 font-semibold">Menu</p>

      <NavLink to="/" end className={link} onClick={onClose}>
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
        </svg>
        Dashboard
      </NavLink>

      {user?.role !== 'STUDENT' ? (
        <NavLink to="/students" className={link} onClick={onClose}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Students
        </NavLink>
      ) : (
        <NavLink to={`/students/${user.id}`} className={link} onClick={onClose}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          My Profile
        </NavLink>
      )}

      {(user?.role === 'ADMIN' || user?.role === 'TEACHER') && (
        <>
          <p className="px-3 mt-5 mb-2 text-xs uppercase tracking-widest text-indigo-300/60 font-semibold">Tools</p>
          {user?.role === 'TEACHER' && (
            <NavLink to="/batch-test-entry" className={link} onClick={onClose}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/>
                <polyline points="17 3 21 7 12 16 8 17 9 13 18 3"/>
              </svg>
              Batch Test Entry
            </NavLink>
          )}
          <NavLink to="/analytics" className={link} onClick={onClose}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            Analytics
          </NavLink>
        </>
      )}

      {user?.role === 'ADMIN' && (
        <>
          <p className="px-3 mt-5 mb-2 text-xs uppercase tracking-widest text-indigo-300/60 font-semibold">Admin</p>
          <NavLink to="/admin/batches" className={link} onClick={onClose}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            Batches
          </NavLink>
          <NavLink to="/admin/teachers" className={link} onClick={onClose}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
              <polyline points="16 11 18 13 22 9"/>
            </svg>
            Teachers
          </NavLink>
        </>
      )}
    </aside>
  );
}
