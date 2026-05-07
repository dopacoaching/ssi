import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="bg-white p-10 rounded-2xl shadow-sm border border-slate-200">
          <div className="text-center mb-10">
            <img src="/dopa-logo.png" alt="DOPA Logo" className="h-16 w-auto mx-auto mb-6" />
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">Student Login</h1>
            <p className="text-xs text-slate-400 mt-2 font-bold uppercase tracking-widest">Portal Access</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Registration ID</label>
              <input
                type="text" required value={regNumber}
                onChange={(e) => setRegNumber(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-200 focus:bg-white rounded-xl px-4 py-3.5 text-sm outline-none transition-all placeholder:text-slate-300"
                placeholder="REG000000"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Password</label>
              <input
                type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-200 focus:bg-white rounded-xl px-4 py-3.5 text-sm outline-none transition-all placeholder:text-slate-300"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-rose-50 text-rose-500 text-[10px] font-bold uppercase tracking-widest p-4 rounded-xl border border-rose-100">
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full bg-slate-900 text-white py-4 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-emerald-600 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {loading ? 'Entering...' : 'Log In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
