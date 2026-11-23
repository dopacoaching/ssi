import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import { useLibrary } from '../../hooks/useLibrary';
import { useStockCheck, type StockCheckView } from '../../hooks/useStockCheck';
import { Banner } from '../../components/CirculationBits';
import { fmtDateTime, inputCls, labelCls, primaryBtn } from '../../components/LibraryBits';

const card = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4';
export const SC_STATUS: Record<StockCheckView['status'], string> = {
  OPEN: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  CLOSED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  CANCELLED: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export default function StockCheck() {
  const navigate = useNavigate();
  const { me, fetchMe } = useLibrary();
  const { list, start } = useStockCheck();
  const [campusId, setCampusId] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<StockCheckView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => { fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library')); }, [fetchMe]);
  const isAdmin = !!me?.isAdmin;
  const LIMIT = 20;

  const load = useCallback(async () => {
    if (!me) return;
    setLoading(true); setError('');
    try {
      const r = await list({ campusId: isAdmin && campusId ? campusId : undefined, page, limit: LIMIT });
      setItems(r.items); setTotal(r.total);
    } catch (e: any) { setError(e.response?.data?.message || 'Could not load stock checks'); }
    finally { setLoading(false); }
  }, [me, isAdmin, campusId, page, list]);

  useEffect(() => { load(); }, [load]);

  const open = items.filter((i) => i.status === 'OPEN');
  const myCampusOpen = !isAdmin && open.length > 0;

  const doStart = async () => {
    if (starting) return;
    if (isAdmin && !campusId) { setError('Choose a campus to start a stock check'); return; }
    setStarting(true); setError('');
    try {
      const sc = await start({ campusId: isAdmin ? campusId : undefined, note: note.trim() || undefined });
      toast.success('Stock check started');
      navigate(`/library/stock-check/${sc.id}`);
    } catch (e: any) { setError(e.response?.data?.message || 'Could not start the stock check'); setStarting(false); load(); }
  };

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Stock check</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Scan every book on the shelves. Books not scanned are listed as missing when you close the check.</p>
        </div>

        {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}

        {open.length > 0 && (
          <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">Open stock check{open.length > 1 ? 's' : ''}</p>
            {open.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-blue-900 dark:text-blue-100">
                <span>{o.campus.name} · started {fmtDateTime(o.startedAt)} · {o.scanCount} scanned</span>
                <Link to={`/library/stock-check/${o.id}`} className={primaryBtn}>Resume</Link>
              </div>
            ))}
          </div>
        )}

        {!myCampusOpen && (
          <div className={`${card} space-y-3`}>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Start a new stock check</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {isAdmin && me && (
                <div>
                  <label className={labelCls} htmlFor="sc-campus">Campus</label>
                  <select id="sc-campus" value={campusId} onChange={(e) => { setCampusId(e.target.value); setPage(1); }} className={inputCls}>
                    <option value="">Select campus…</option>
                    {me.campuses.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className={labelCls} htmlFor="sc-note">Note (optional)</label>
                <input id="sc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputCls} placeholder="e.g. Annual stock check" />
              </div>
            </div>
            <button type="button" onClick={doStart} disabled={starting} className={primaryBtn}>{starting ? 'Starting…' : 'Start stock check'}</button>
          </div>
        )}

        <div className={card}>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">History</p>
          {loading ? <div className="h-24 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" /> : items.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No stock checks yet.</p>
          ) : (
            <div className="space-y-2">
              {items.map((i) => (
                <Link key={i.id} to={`/library/stock-check/${i.id}`}
                  className="block border border-gray-100 dark:border-gray-700 rounded-xl p-3 text-sm hover:border-indigo-300 dark:hover:border-indigo-600">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-gray-800 dark:text-gray-100">{i.campus.name} · {fmtDateTime(i.startedAt)}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SC_STATUS[i.status]}`}>{i.status}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {i.scanCount} scanned{i.status === 'CLOSED' ? ` · ${i.missingCount ?? i.missing.length} missing` : ''} · by {i.startedBy?.name || '-'}{i.note ? ` · ${i.note}` : ''}
                  </p>
                </Link>
              ))}
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="text-indigo-600 dark:text-indigo-400 disabled:opacity-40">Previous</button>
              <span className="text-gray-500 dark:text-gray-400">Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="text-indigo-600 dark:text-indigo-400 disabled:opacity-40">Next</button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
