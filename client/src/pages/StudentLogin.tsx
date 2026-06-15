import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ThemeToggle from '../components/ThemeToggle';

export default function StudentLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [regNumber, setRegNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login({ regNumber }, password);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid registration or password');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gray-900 flex items-center justify-center relative p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg w-full max-w-sm p-8 border border-slate-200 dark:border-gray-700">
        <div className="flex flex-col items-center mb-8">
          <img src="/dopa-logo.png" alt="DOPA Logo" className="h-16 w-auto mb-5 rounded-xl" />
          <h1 className="text-xl font-bold text-slate-800 dark:text-gray-100 tracking-tight">Student Login</h1>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 rounded-full mt-2">
            Portal Access
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="student-reg" className="block text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-widest mb-2">
              Registration ID
            </label>
            <input
              id="student-reg"
              type="text"
              autoComplete="username"
              required
              value={regNumber}
              onChange={(e) => setRegNumber(e.target.value)}
              className="w-full bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 focus:border-emerald-400 dark:focus:border-emerald-500 focus:bg-white dark:focus:bg-gray-600 rounded-xl px-4 py-3.5 text-sm text-slate-800 dark:text-gray-100 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-gray-500"
              placeholder="REG000000"
            />
          </div>
          <div>
            <label htmlFor="student-password" className="block text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-widest mb-2">
              Password
            </label>
            <input
              id="student-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 focus:border-emerald-400 dark:focus:border-emerald-500 focus:bg-white dark:focus:bg-gray-600 rounded-xl px-4 py-3.5 text-sm text-slate-800 dark:text-gray-100 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-gray-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-semibold uppercase tracking-widest p-4 rounded-xl border border-rose-100 dark:border-rose-900/40">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 dark:bg-emerald-600 text-white py-4 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-emerald-600 dark:hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50 mt-1"
          >
            {loading ? 'Entering...' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}
