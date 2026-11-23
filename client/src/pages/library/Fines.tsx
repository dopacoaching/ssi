import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import EmptyState from '../../components/EmptyState';
import CollectPaymentModal from '../../components/CollectPaymentModal';
import { useLibrary } from '../../hooks/useLibrary';
import { useFines, type PendingFineItem } from '../../hooks/useFines';
import { inputCls, primaryBtn, ghostBtn, CampusPill } from '../../components/LibraryBits';
import { money, fmtDay } from '../../components/CirculationBits';
import { exportPendingFinesExcel } from '../../utils/libraryExport';

const LIMIT = 25;
const EXPORT_MAX = 2000;
const box = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl';

export default function Fines() {
  const { me, fetchMe } = useLibrary();
  const { listPendingFines } = useFines();

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [campusId, setCampusId] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<PendingFineItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ balance: 0, accruing: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [collect, setCollect] = useState<PendingFineItem | null>(null);
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
    listPendingFines({ q: debouncedQ, campusId: isAdmin ? campusId : undefined, page, limit: LIMIT })
      .then((r) => { if (id === reqId.current) { setItems(r.items); setTotal(r.total); setTotals(r.totals); } })
      .catch((e: any) => { if (id === reqId.current) { setFailed(true); setItems([]); setTotal(0); toast.error(e.response?.data?.message || 'Failed to load fines'); } })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [me, listPendingFines, debouncedQ, campusId, page, isAdmin, retry]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const showCampus = isAdmin && !campusId;

  const doExport = async () => {
    setExporting(true);
    try {
      const all: PendingFineItem[] = [];
      for (let p = 1; all.length < EXPORT_MAX; p++) {
        const r = await listPendingFines({ q: q.trim(), campusId: isAdmin ? campusId : undefined, page: p, limit: 100 });
        all.push(...r.items);
        if (all.length >= r.total || r.items.length === 0) break;
      }
      if (all.length === 0) { toast.error('Nothing to export'); return; }
      exportPendingFinesExcel(all.slice(0, EXPORT_MAX), `library-pending-fines-${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}.xlsx`);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  const collectBtn = (i: PendingFineItem) => (
    <button type="button" onClick={() => setCollect(i)} disabled={i.balance <= 0} className={`${primaryBtn} !py-1.5 !px-3`}>Collect</button>
  );
  const viewLink = (i: PendingFineItem) => (
    <Link to={`/library/students/${i.student.regNumber}`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View</Link>
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Fines</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Students with pending payable charges</p>
          </div>
          <button type="button" onClick={doExport} disabled={exporting || total === 0} className={ghostBtn}>{exporting ? 'Exporting…' : 'Export Excel'}</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className={`${box} p-4`}><p className="text-xs text-gray-500 dark:text-gray-400">Pending to collect</p><p className="text-xl font-bold text-red-600 dark:text-red-300">{money(totals.balance)}</p></div>
          <div className={`${box} p-4`}><p className="text-xs text-gray-500 dark:text-gray-400">Accruing (on open loans)</p><p className="text-xl font-bold text-amber-600 dark:text-amber-300">{money(totals.accruing)}</p></div>
          <div className={`${box} p-4 col-span-2 sm:col-span-1`}><p className="text-xs text-gray-500 dark:text-gray-400">Students</p><p className="text-xl font-bold text-gray-800 dark:text-gray-100">{total}</p></div>
        </div>

        <div className={`${box} p-4 flex flex-col sm:flex-row gap-3`}>
          <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} aria-label="Search students" placeholder="Search by reg number or student name" />
          {isAdmin && me && (
            <select value={campusId} onChange={(e) => { setCampusId(e.target.value); setPage(1); }} className={`${inputCls} sm:w-56`} aria-label="Campus">
              <option value="">All campuses</option>
              {me.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {failed && !loading ? (
          <div className={`${box} py-10 text-center space-y-3`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">Could not load fines.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className={primaryBtn}>Retry</button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="space-y-3">{[1, 2, 3, 4].map((n) => <div key={n} className="h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}</div>
        ) : items.length === 0 ? (
          <div className={box}><EmptyState icon="document" title="No pending fines" description={debouncedQ ? 'Try a different search.' : 'Nothing to collect right now.'} /></div>
        ) : (
          <div className={loading ? 'opacity-60' : ''}>
            <div className={`hidden md:block ${box} overflow-x-auto`}>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-3 px-4 font-medium">Student</th><th className="py-3 pr-3 font-medium">Batch</th>
                  <th className="py-3 pr-3 font-medium text-right">Pending</th><th className="py-3 pr-3 font-medium text-right">Accruing</th>
                  <th className="py-3 pr-3 font-medium">Oldest charge</th><th className="py-3 pr-4 font-medium text-right">Actions</th>
                </tr></thead>
                <tbody>{items.map((i) => (
                  <tr key={`${i.student.id}-${i.campus.id}`} className="border-b border-gray-50 dark:border-gray-700/50 align-middle text-gray-800 dark:text-gray-100">
                    <td className="py-3 px-4">
                      <span className="font-medium">{i.student.fullName}</span> {showCampus && <CampusPill code={i.campus.code} />}
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{i.student.regNumber}</p>
                    </td>
                    <td className="py-3 pr-3 text-xs">{i.student.batch?.name || '—'}</td>
                    <td className="py-3 pr-3 text-right font-semibold text-red-600 dark:text-red-300">{money(i.balance)}<p className="text-xs font-normal text-gray-400">{i.chargeCount} {i.chargeCount === 1 ? 'charge' : 'charges'}</p></td>
                    <td className="py-3 pr-3 text-right">{i.accruing > 0 ? <span className="text-amber-600 dark:text-amber-300" title="Payable on return">{money(i.accruing)}</span> : '—'}</td>
                    <td className="py-3 pr-3 whitespace-nowrap text-xs">{fmtDay(i.oldestChargeAt)}</td>
                    <td className="py-3 pr-4"><div className="flex items-center justify-end gap-3">{viewLink(i)}{collectBtn(i)}</div></td>
                  </tr>))}</tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">{items.map((i) => (
              <div key={`${i.student.id}-${i.campus.id}`} className={`${box} p-4`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{i.student.fullName} {showCampus && <CampusPill code={i.campus.code} />}</p>
                  <span className="text-sm font-bold text-red-600 dark:text-red-300">{money(i.balance)}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400"><span className="font-mono">{i.student.regNumber}</span> · {i.student.batch?.name || 'No batch'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {i.chargeCount} {i.chargeCount === 1 ? 'charge' : 'charges'} · since {fmtDay(i.oldestChargeAt)}
                  {i.accruing > 0 && <> · <span className="text-amber-600 dark:text-amber-300">{money(i.accruing)} accruing (payable on return)</span></>}
                </p>
                <div className="flex items-center justify-end gap-4 mt-3">{viewLink(i)}{collectBtn(i)}</div>
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

      {collect && (
        <CollectPaymentModal
          studentId={collect.student.id}
          campusId={collect.campus.id}
          onClose={() => { setCollect(null); setRetry((n) => n + 1); }}
          onDone={() => { /* list refreshes when the modal is closed */ }}
        />
      )}
    </Layout>
  );
}
