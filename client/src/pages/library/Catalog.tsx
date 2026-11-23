import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import EmptyState from '../../components/EmptyState';
import { useLibrary } from '../../hooks/useLibrary';
import { useCatalog, type Book, type CopyStatus } from '../../hooks/useCatalog';
import { OverdueChip } from '../../components/CirculationBits';
import { StatusChip, CampusPill, inputCls, primaryBtn, ghostBtn } from '../../components/LibraryBits';

const STATUSES: CopyStatus[] = ['AVAILABLE', 'ISSUED', 'DAMAGED', 'LOST', 'WITHDRAWN'];
const LIMIT = 25;

export default function Catalog() {
  const navigate = useNavigate();
  const { me, fetchMe } = useLibrary();
  const { listBooks } = useCatalog();

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(() => { const s = sp.get('status') || ''; return STATUSES.includes(s as CopyStatus) ? s : ''; });
  const [category, setCategory] = useState('');
  const [shelf, setShelf] = useState('');
  const [campusId, setCampusId] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Book[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const reqId = useRef(0);

  useEffect(() => {
    fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library'));
  }, [fetchMe]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setFailed(false);
    listBooks({ q: debouncedQ, status, category, shelf, campusId: me?.isAdmin ? campusId : undefined, page, limit: LIMIT })
      .then((r) => { if (id === reqId.current) { setItems(r.items); setTotal(r.total); } })
      .catch((e: any) => { if (id === reqId.current) { setFailed(true); setItems([]); setTotal(0); toast.error(e.response?.data?.message || 'Failed to load catalog'); } })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [listBooks, debouncedQ, status, category, shelf, campusId, page, me?.isAdmin, retry]);

  const { categories, shelves } = useMemo(() => {
    const src = !me ? [] : me.isAdmin && !campusId ? me.campuses : me.campuses.filter((c) => !me.isAdmin || c.id === campusId);
    const cats = new Set<string>(); const shl = new Set<string>();
    src.forEach((c) => { c.categories.forEach((x) => cats.add(x)); c.shelfLocations.forEach((x) => shl.add(x)); });
    return { categories: [...cats].sort(), shelves: [...shl].sort() };
  }, [me, campusId]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const showCampus = !!me?.isAdmin && !campusId;
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selCls = `${inputCls} sm:w-auto`;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Catalog</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{total} {total === 1 ? 'book' : 'books'}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/library/catalog/upload" className={ghostBtn}>Bulk upload</Link>
            <Link to="/library/catalog/new" className={primaryBtn}>Add book</Link>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 mb-4 space-y-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls}
            placeholder="Search by catalog number, title, author, category, shelf or ISBN" aria-label="Search catalog" />
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            {me?.isAdmin && (
              <select value={campusId} onChange={(e) => { setCampusId(e.target.value); setCategory(''); setShelf(''); setPage(1); }} className={selCls} aria-label="Campus">
                <option value="">All campuses</option>
                {me.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={selCls} aria-label="Status">
              <option value="">Any status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
            </select>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className={selCls} aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={shelf} onChange={(e) => { setShelf(e.target.value); setPage(1); }} className={selCls} aria-label="Shelf">
              <option value="">All shelves</option>
              {shelves.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {failed && !loading ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl py-10 text-center space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">Could not load the catalog.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className={primaryBtn}>Retry</button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((n) => <div key={n} className="h-20 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl">
            <EmptyState icon="document" title="No books found"
              description={debouncedQ || status || category || shelf ? 'Try changing the search or filters.' : 'Add your first book to start the catalog.'} />
          </div>
        ) : (
          <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
            {items.map((b) => {
              const open = expanded.has(b.id);
              return (
                <div key={b.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl">
                  <div className="p-4 flex items-start gap-3">
                    <button type="button" onClick={() => navigate(`/library/books/${b.id}`)} className="flex-1 min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 break-words">{b.title}</p>
                        {showCampus && b.campus && <CampusPill code={b.campus.code} />}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {[b.author, b.category].filter(Boolean).join(' · ') || 'No author or category'}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          {b.copyCounts.total} {b.copyCounts.total === 1 ? 'copy' : 'copies'}
                        </span>
                        {STATUSES.filter((s) => b.copyCounts[s] > 0).map((s) => <StatusChip key={s} status={s} count={b.copyCounts[s]} />)}
                      </div>
                    </button>
                    <button type="button" onClick={() => toggle(b.id)} aria-expanded={open} aria-label={open ? 'Hide copies' : 'Show copies'}
                      className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className={`transition-transform ${open ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                    </button>
                  </div>
                  {open && (
                    <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3">
                      {(b.copies ?? []).length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500">No copies.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                          {(b.copies ?? []).map((c) => (
                            <div key={c.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-mono text-gray-700 dark:text-gray-200">{c.catalogNumber}</span>
                              <span className="text-gray-400 dark:text-gray-500 truncate flex-1 text-right">{c.shelfLocation || '—'}</span>
                              <span className="flex items-center gap-1.5">
                                {c.status === 'ISSUED' && c.loan?.isOverdue && <OverdueChip />}
                                <StatusChip status={c.status} />
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={ghostBtn}>Previous</button>
            <span className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className={ghostBtn}>Next</button>
          </div>
        )}
      </div>
    </Layout>
  );
}
