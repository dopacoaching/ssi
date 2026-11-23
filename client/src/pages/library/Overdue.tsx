import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import EmptyState from '../../components/EmptyState';
import { useLibrary } from '../../hooks/useLibrary';
import { useCirculation, type LoanListView, type LoanView } from '../../hooks/useCirculation';
import { inputCls, primaryBtn, ghostBtn, CampusPill } from '../../components/LibraryBits';
import { money, fmtYmd, OverdueChip, WaivedDaysNote } from '../../components/CirculationBits';
import { exportLoansExcel } from '../../utils/libraryExport';

const TABS: { view: LoanListView; label: string }[] = [
  { view: 'overdue', label: 'Overdue' },
  { view: 'dueToday', label: 'Due today' },
  { view: 'dueSoon', label: 'Due in 2 days' },
  { view: 'open', label: 'All open' },
];
const LIMIT = 25;
const EXPORT_MAX = 2000;

export default function Overdue() {
  const { me, fetchMe } = useLibrary();
  const { listLoans } = useCirculation();

  const [view, setView] = useState<LoanListView>('overdue');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [campusId, setCampusId] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<LoanView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);

  useEffect(() => { fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library')); }, [fetchMe]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const isAdmin = !!me?.isAdmin;

  useEffect(() => {
    if (!me) return;
    const id = ++reqId.current;
    setLoading(true); setFailed(false);
    listLoans({ view, q: debouncedQ, campusId: isAdmin ? campusId : undefined, page, limit: LIMIT })
      .then((r) => { if (id === reqId.current) { setItems(r.items); setTotal(r.total); } })
      .catch((e: any) => { if (id === reqId.current) { setFailed(true); setItems([]); setTotal(0); toast.error(e.response?.data?.message || 'Failed to load loans'); } })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [me, listLoans, view, debouncedQ, campusId, page, isAdmin, retry]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const showCampus = isAdmin && !campusId;
  const viewLabel = TABS.find((t) => t.view === view)?.label || 'Loans';

  const doExport = async () => {
    setExporting(true);
    try {
      const all: LoanView[] = [];
      for (let p = 1; all.length < EXPORT_MAX; p++) {
        const r = await listLoans({ view, q: q.trim(), campusId: isAdmin ? campusId : undefined, page: p, limit: 100 });
        all.push(...r.items);
        if (all.length >= r.total || r.items.length === 0) break;
      }
      if (all.length === 0) { toast.error('Nothing to export'); return; }
      exportLoansExcel(all.slice(0, EXPORT_MAX), viewLabel, `library-${view}-${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}.xlsx`);
      if (all.length >= EXPORT_MAX && total > EXPORT_MAX) toast(`Exported the first ${EXPORT_MAX} rows`);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Overdue &amp; due books</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{total} {total === 1 ? 'loan' : 'loans'}</p>
          </div>
          <button type="button" onClick={doExport} disabled={exporting || total === 0} className={ghostBtn}>
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.view} type="button" aria-pressed={view === t.view} onClick={() => { setView(t.view); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-sm font-medium ${view === t.view ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} aria-label="Search loans"
            placeholder="Search by reg number, student name or catalog number" />
          {isAdmin && me && (
            <select value={campusId} onChange={(e) => { setCampusId(e.target.value); setPage(1); }} className={`${inputCls} sm:w-56`} aria-label="Campus">
              <option value="">All campuses</option>
              {me.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {failed && !loading ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl py-10 text-center space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">Could not load loans.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className={primaryBtn}>Retry</button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="space-y-3">{[1, 2, 3, 4].map((n) => <div key={n} className="h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}</div>
        ) : items.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl">
            <EmptyState icon="document" title="No loans found" description={debouncedQ ? 'Try a different search.' : 'Nothing in this view right now.'} />
          </div>
        ) : (
          <div className={loading ? 'opacity-60' : ''}>
            <div className="hidden md:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-3 px-4 font-medium">Student</th><th className="py-3 pr-3 font-medium">Batch</th>
                  <th className="py-3 pr-3 font-medium">Book</th><th className="py-3 pr-3 font-medium">Due</th>
                  <th className="py-3 pr-3 font-medium text-right">Days late</th><th className="py-3 pr-4 font-medium text-right">Fine</th>
                </tr></thead>
                <tbody>{items.map((l) => (
                  <tr key={l.id} className="border-b border-gray-50 dark:border-gray-700/50 align-top text-gray-800 dark:text-gray-100">
                    <td className="py-3 px-4">
                      <Link to={`/library/students/${l.student.regNumber}`} className="font-medium hover:underline">{l.student.fullName}</Link>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{l.student.regNumber}</p>
                    </td>
                    <td className="py-3 pr-3 text-xs">{l.student.batch?.name || '—'}</td>
                    <td className="py-3 pr-3">
                      <Link to={`/library/books/${l.book.id}`} className="hover:underline">{l.book.title}</Link>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{l.copy.catalogNumber} {showCampus && <CampusPill code={l.campus.code} />}</p>
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap">{fmtYmd(l.dueDate)}</td>
                    <td className={`py-3 pr-3 text-right ${l.daysLate > 0 ? 'text-red-600 dark:text-red-300 font-semibold' : ''}`}>{l.daysLate}{(l.waivedDays ?? 0) > 0 && <div className="font-normal"><WaivedDaysNote days={l.waivedDays!} /></div>}</td>
                    <td className={`py-3 pr-4 text-right ${l.lateFine > 0 ? 'text-red-600 dark:text-red-300 font-semibold' : ''}`}>{money(l.lateFine)}</td>
                  </tr>))}</tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">{items.map((l) => (
              <div key={l.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/library/students/${l.student.regNumber}`} className="text-sm font-semibold text-gray-800 dark:text-gray-100">{l.student.fullName}</Link>
                  {l.isOverdue && <OverdueChip days={l.daysLate} />}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400"><span className="font-mono">{l.student.regNumber}</span> · {l.student.batch?.name || 'No batch'}</p>
                <p className="text-sm text-gray-700 dark:text-gray-200 mt-2 break-words">
                  <span className="font-mono text-xs">{l.copy.catalogNumber}</span> {l.book.title} {showCampus && <CampusPill code={l.campus.code} />}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Due {fmtYmd(l.dueDate)} · Fine <span className={l.lateFine > 0 ? 'text-red-600 dark:text-red-300 font-semibold' : ''}>{money(l.lateFine)}</span></p>
              </div>))}
            </div>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={ghostBtn}>Previous</button>
            <span className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className={ghostBtn}>Next</button>
          </div>
        )}
      </div>
    </Layout>
  );
}
