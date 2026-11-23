import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import EmptyState from '../../components/EmptyState';
import ReasonModal from '../../components/ReasonModal';
import { useLibrary } from '../../hooks/useLibrary';
import { useFines, type PaymentSummary, type PaymentView } from '../../hooks/useFines';
import { inputCls, labelCls, primaryBtn, ghostBtn, CampusPill, fmtDateTime } from '../../components/LibraryBits';
import { money } from '../../components/CirculationBits';
import { printReceipt } from '../../utils/librarySlip';
import { exportPaymentsExcel } from '../../utils/libraryExport';

const LIMIT = 25;
const EXPORT_MAX = 2000;
const box = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl';
const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function Payments() {
  const { me, fetchMe } = useLibrary();
  const { getPaymentSummary, listPayments, voidPayment } = useFines();

  const [date, setDate] = useState(todayIst);
  const [from, setFrom] = useState(todayIst);
  const [to, setTo] = useState(todayIst);
  const [campusId, setCampusId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [includeVoided, setIncludeVoided] = useState(true);
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [sumFailed, setSumFailed] = useState(false);
  const [items, setItems] = useState<PaymentView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [voiding, setVoiding] = useState<PaymentView | null>(null);
  const [staffOpts, setStaffOpts] = useState<{ id: string; name: string }[]>([]);
  const reqId = useRef(0);
  const sumReq = useRef(0);

  useEffect(() => { fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library')); }, [fetchMe]);
  const isAdmin = !!me?.isAdmin;
  const scopeCampus = isAdmin ? campusId : '';

  useEffect(() => {
    if (!me) return;
    const id = ++sumReq.current;
    setSumFailed(false);
    getPaymentSummary({ date, campusId: scopeCampus || undefined })
      .then((s) => {
        if (id !== sumReq.current) return;
        setSummary(s);
        if (isAdmin) setStaffOpts((prev) => {
          const m = new Map(prev.map((x) => [x.id, x]));
          s.byStaff.forEach((b) => m.set(b.staff.id, b.staff));
          return Array.from(m.values());
        });
      })
      .catch((e: any) => { if (id === sumReq.current) { setSummary(null); setSumFailed(true); toast.error(e.response?.data?.message || 'Failed to load summary'); } });
  }, [me, getPaymentSummary, date, scopeCampus, isAdmin, retry]);

  const query = { campusId: scopeCampus || undefined, from, to, staffId: isAdmin ? staffId || undefined : undefined, includeVoided };

  useEffect(() => {
    if (!me) return;
    const id = ++reqId.current;
    setLoading(true); setFailed(false);
    listPayments({ ...query, page, limit: LIMIT })
      .then((r) => { if (id === reqId.current) { setItems(r.items); setTotal(r.total); } })
      .catch((e: any) => { if (id === reqId.current) { setFailed(true); setItems([]); setTotal(0); toast.error(e.response?.data?.message || 'Failed to load payments'); } })
      .finally(() => { if (id === reqId.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, listPayments, scopeCampus, from, to, staffId, includeVoided, page, isAdmin, retry]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const showCampus = isAdmin && !campusId;

  const changeDate = (d: string) => { if (!d) return; setDate(d); setFrom(d); setTo(d); setPage(1); };

  const doExport = async () => {
    setExporting(true);
    try {
      const all: PaymentView[] = [];
      for (let p = 1; all.length < EXPORT_MAX; p++) {
        const r = await listPayments({ ...query, page: p, limit: 100 });
        all.push(...r.items);
        if (all.length >= r.total || r.items.length === 0) break;
      }
      if (all.length === 0) { toast.error('Nothing to export'); return; }
      exportPaymentsExcel(all.slice(0, EXPORT_MAX), `library-payments-${from}${to !== from ? `_to_${to}` : ''}.xlsx`);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  const statusBadge = (p: PaymentView) => p.voided
    ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" title={p.voided.reason}>VOID</span>
    : null;

  const actions = (p: PaymentView) => (
    <div className="flex items-center justify-end gap-3">
      <button type="button" onClick={() => printReceipt(p)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">Reprint</button>
      {isAdmin && !p.voided && <button type="button" onClick={() => setVoiding(p)} className="text-sm text-red-600 dark:text-red-300 hover:underline">Void</button>}
    </div>
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Payments</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Cash collection and receipts</p>
          </div>
          <button type="button" onClick={doExport} disabled={exporting || total === 0} className={ghostBtn}>{exporting ? 'Exporting…' : 'Export Excel'}</button>
        </div>

        <div className={`${box} p-4 flex flex-col sm:flex-row sm:items-end gap-3`}>
          <div>
            <label className={labelCls} htmlFor="pay-date">Collection date (IST)</label>
            <input id="pay-date" type="date" value={date} max={todayIst()} onChange={(e) => changeDate(e.target.value)} className={inputCls} />
          </div>
          {isAdmin && me && (
            <div className="sm:w-56">
              <label className={labelCls} htmlFor="pay-campus">Campus</label>
              <select id="pay-campus" value={campusId} onChange={(e) => { setCampusId(e.target.value); setStaffId(''); setStaffOpts([]); setPage(1); }} className={inputCls}>
                <option value="">All campuses</option>
                {me.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <button type="button" onClick={() => changeDate(todayIst())} className={ghostBtn}>Today</button>
        </div>

        {sumFailed ? (
          <div className={`${box} py-6 text-center space-y-3`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">Could not load the daily summary.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className={primaryBtn}>Retry</button>
          </div>
        ) : !summary ? (
          <div className="grid grid-cols-3 gap-3">{[1, 2, 3].map((n) => <div key={n} className="h-20 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className={`${box} p-4`}><p className="text-xs text-gray-500 dark:text-gray-400">My collection</p><p className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">{money(summary.myTotal)}</p><p className="text-xs text-gray-400">{summary.myCount} receipts</p></div>
              <div className={`${box} p-4`}><p className="text-xs text-gray-500 dark:text-gray-400">{summary.campus ? summary.campus.name : 'All campuses'}</p><p className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-300">{money(summary.campusTotal)}</p><p className="text-xs text-gray-400">total</p></div>
              <div className={`${box} p-4`}><p className="text-xs text-gray-500 dark:text-gray-400">Receipts</p><p className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">{summary.campusCount}</p><p className="text-xs text-gray-400">excl. voided</p></div>
            </div>
            {summary.paymentsTruncated && <p className="text-xs text-gray-500 dark:text-gray-400">Showing the first {summary.payments.length} receipts; totals include all.</p>}
            {summary.byStaff.length > 0 && (
              <div className={`${box} p-4`}>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">By staff - {date}</p>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                    <th className="py-2 font-medium">Staff</th><th className="py-2 font-medium text-right">Receipts</th><th className="py-2 font-medium text-right">Total</th>
                  </tr></thead>
                  <tbody>{summary.byStaff.map((b) => (
                    <tr key={b.staff.id} className="border-b border-gray-50 dark:border-gray-700/50 text-gray-800 dark:text-gray-100">
                      <td className="py-2">{b.staff.name}</td><td className="py-2 text-right">{b.count}</td><td className="py-2 text-right font-semibold">{money(b.total)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className={`${box} p-4 grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3`}>
          <div>
            <label className={labelCls} htmlFor="pay-from">From</label>
            <input id="pay-from" type="date" value={from} max={to} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setPage(1); } }} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="pay-to">To</label>
            <input id="pay-to" type="date" value={to} min={from} max={todayIst()} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setPage(1); } }} className={inputCls} />
          </div>
          {isAdmin && (
            <div>
              <label className={labelCls} htmlFor="pay-staff">Staff</label>
              <select id="pay-staff" value={staffId} onChange={(e) => { setStaffId(e.target.value); setPage(1); }} className={inputCls}>
                <option value="">All staff</option>
                {staffOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer self-center">
            <input type="checkbox" checked={includeVoided} onChange={(e) => { setIncludeVoided(e.target.checked); setPage(1); }} /> Show voided
          </label>
        </div>

        {failed && !loading ? (
          <div className={`${box} py-10 text-center space-y-3`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">Could not load payments.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className={primaryBtn}>Retry</button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}</div>
        ) : items.length === 0 ? (
          <div className={box}><EmptyState icon="document" title="No receipts" description="No payments in this range." /></div>
        ) : (
          <div className={loading ? 'opacity-60' : ''}>
            <div className={`hidden md:block ${box} overflow-x-auto`}>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-3 px-4 font-medium">Receipt</th><th className="py-3 pr-3 font-medium">Time</th>
                  <th className="py-3 pr-3 font-medium">Student</th><th className="py-3 pr-3 font-medium text-right">Amount</th>
                  <th className="py-3 pr-3 font-medium">Received by</th><th className="py-3 pr-4 font-medium text-right">Actions</th>
                </tr></thead>
                <tbody>{items.map((p) => (
                  <tr key={p.id} className={`border-b border-gray-50 dark:border-gray-700/50 align-middle text-gray-800 dark:text-gray-100 ${p.voided ? 'opacity-60' : ''}`}>
                    <td className="py-3 px-4 font-mono text-xs whitespace-nowrap">{p.receiptNumber} {statusBadge(p)} {showCampus && <CampusPill code={p.campus.code} />}</td>
                    <td className="py-3 pr-3 whitespace-nowrap text-xs">{fmtDateTime(p.receivedAt)}</td>
                    <td className="py-3 pr-3"><Link to={`/library/students/${p.student.regNumber}`} className="hover:underline">{p.student.fullName}</Link><p className="text-xs font-mono text-gray-500 dark:text-gray-400">{p.student.regNumber}</p></td>
                    <td className={`py-3 pr-3 text-right font-semibold ${p.voided ? 'line-through' : ''}`}>{money(p.amount)}</td>
                    <td className="py-3 pr-3 text-xs">{p.receivedBy?.name || '—'}</td>
                    <td className="py-3 pr-4">{actions(p)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <div className="md:hidden space-y-3">{items.map((p) => (
              <div key={p.id} className={`${box} p-4 ${p.voided ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-mono text-gray-700 dark:text-gray-200">{p.receiptNumber} {statusBadge(p)}</p>
                  <span className={`text-sm font-bold text-gray-800 dark:text-gray-100 ${p.voided ? 'line-through' : ''}`}>{money(p.amount)}</span>
                </div>
                <p className="text-sm text-gray-800 dark:text-gray-100 mt-1">{p.student.fullName} {showCampus && <CampusPill code={p.campus.code} />}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{fmtDateTime(p.receivedAt)} · {p.receivedBy?.name || '—'}</p>
                {p.voided && <p className="text-xs text-red-600 dark:text-red-300 mt-1">Voided: {p.voided.reason}</p>}
                <div className="mt-2">{actions(p)}</div>
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

      {voiding && (
        <ReasonModal
          title={`Void receipt ${voiding.receiptNumber}`}
          message={<>This reverses {money(voiding.amount)} paid by {voiding.student.fullName}. The receipt number stays used.</>}
          confirmLabel="Void receipt" danger
          onClose={() => setVoiding(null)}
          onSubmit={async (reason) => {
            await voidPayment(voiding.id, reason);
            toast.success('Receipt voided');
            setVoiding(null); setRetry((n) => n + 1);
          }}
        />
      )}
    </Layout>
  );
}
