import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { useAuth } from '../hooks/useAuth';
import { useStudents, Student } from '../hooks/useStudents';
import ThemeToggle from './ThemeToggle';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface Props { onMenuToggle?: () => void }

export default function Navbar({ onMenuToggle }: Props) {
  const user = useSelector((s: RootState) => s.auth.user);
  const { logout } = useAuth();
  const { search } = useStudents();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Student[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isStaff = user?.role === 'ADMIN' || user?.role === 'TEACHER';
  const { canInstall, install } = usePWAInstall();

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    const r = await search(q).catch(() => []);
    setResults(r);
    setOpen(true);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(t);
  }, [query, doSearch]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSelect(id: string) {
    setQuery(''); setResults([]); setOpen(false);
    navigate(`/students/${id}`);
  }

  return (
    <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 lg:px-6 flex-shrink-0 z-10">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2.5 -ml-1 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Open menu"
        >
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6"  x2="21" y2="6"  />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/dopa-logo.png" alt="DOPA" className="h-8 w-auto object-contain" />
          <span className="hidden md:block text-sm font-semibold text-gray-600 dark:text-gray-300 tracking-tight">
            Student Success Index
          </span>
        </Link>
      </div>

      {isStaff && (
        <div ref={wrapRef} className="relative hidden sm:block mx-4 flex-1 max-w-xs">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setOpen(false)}
            placeholder="Search students…"
            className="w-full text-sm border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400 dark:placeholder-gray-500"
          />
          <svg className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          {open && results.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg z-50 overflow-hidden">
              {results.map(s => (
                <button key={s.id} onMouseDown={() => handleSelect(s.id)}
                  className="w-full text-left px-4 py-3 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-between gap-3 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{s.fullName}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{s.regNumber}</p>
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{s.batch?.name}</span>
                </button>
              ))}
            </div>
          )}
          {open && query.trim().length >= 2 && results.length === 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg z-50 px-4 py-3">
              <p className="text-sm text-gray-400 dark:text-gray-500">No students found</p>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 sm:gap-2">
        {canInstall && (
          <button
            onClick={install}
            className="lg:hidden flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl transition-colors"
            title="Install app"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M12 16V4M8 12l4 4 4-4"/>
              <path d="M4 20h16"/>
            </svg>
            Install
          </button>
        )}
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 hidden sm:block mr-1">{user?.name}</span>
        <span className="text-xs bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-full font-medium">
          {user?.role}
        </span>
        <ThemeToggle />
        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700"
          aria-label="Logout"
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
