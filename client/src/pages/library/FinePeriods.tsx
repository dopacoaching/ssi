import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import Layout from '../../components/Layout';
import EmptyState from '../../components/EmptyState';
import ReasonModal from '../../components/ReasonModal';
import { useLibrary } from '../../hooks/useLibrary';
import { useFines, type FinePeriodPreview, type FinePeriodView } from '../../hooks/useFines';
import { inputCls, labelCls, primaryBtn, ghostBtn, CampusPill, fmtDateTime } from '../../components/LibraryBits';
import { Banner, money, fmtYmd } from '../../components/CirculationBits';

const box = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl';

export default function FinePeriods() {
  const role = useSelector((s: RootState) => s.auth.user?.role);
  const { me, fetchMe } = useLibrary();
  const { listFinePeriods, previewFinePeriod, createFinePeriod, cancelFinePeriod } = useFines();

  const [filterCampus, setFilterCampus] = useState('');
  const [periods, setPeriods] = useState<FinePeriodView[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  const [fCampus, setFCampus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<FinePeriodPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<FinePeriodView | null>(null);
  const reqId = useRef(0);

  const isAdmin = role === 'ADMIN';

  useEffect(() => { fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library')); }, [fetchMe]);

  useEffect(() => {
    if (!isAdmin) return;
    const id = ++reqId.current;
    setLoading(true); setFailed(false);
    listFinePeriods(filterCampus || undefined)
      .then((r) => { if (id === reqId.current) setPeriods(r); })
      .catch((e: any) => { if (id === reqId.current) { setFailed(true); toast.error(e.response?.data?.message || 'Failed to load periods'); } })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [isAdmin, listFinePeriods, filterCampus, retry]);

  if (!isAdmin) {
    return <Layout><div className="max-w-3xl mx-auto"><Banner kind="error">Only an admin can manage no-fine periods.</Banner></div></Layout>;
  }

  const invalidate = () => { setPreview(null); setError(''); };
  const formError = () => {
    if (!fCampus) return 'Choose a campus';
    if (!from || !to) return 'Choose the from and to dates';
    if (from > to) return 'The start date must not be after the end date';
    if (!reason.trim()) return 'A reason is required';
    return '';
  };

  const doPreview = async () => {
    if (busyRef.current) return;
    const fe = formError();
    if (fe) { setError(fe); return; }
    busyRef.current = true; setBusy(true); setError('');
    try { setPreview(await previewFinePeriod({ campusId: fCampus, from, to })); }
    catch (e: any) { setError(e.response?.data?.message || 'Could not preview'); setPreview(null); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const doCreate = async () => {
    if (busyRef.current || !preview) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const r = await createFinePeriod({ campusId: fCampus, from, to, reason: reason.trim() });
      toast.success(`Period created - ${r.appliedWaivers} charges waived (${money(r.totalWaived)})`);
      setFrom(''); setTo(''); setReason(''); setPreview(null);
      setRetry((n) => n + 1);
    } catch (e: any) { setError(e.response?.data?.message || 'Could not create the period'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">No-fine periods</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Days in a period (holidays, closures) are not counted as late for any book at that campus.</p>
        </div>

        <div className={`${box} p-5 space-y-4`}>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">New period</p>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls} htmlFor="fp-campus">Campus</label>
              <select id="fp-campus" value={fCampus} onChange={(e) => { setFCampus(e.target.value); invalidate(); }} className={inputCls}>
                <option value="">Select campus…</option>
                {me?.campuses.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="fp-from">From</label>
              <input id="fp-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); invalidate(); }} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="fp-to">To (inclusive)</label>
              <input id="fp-to" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); invalidate(); }} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="fp-reason">Reason (required)</label>
            <input id="fp-reason" value={reason} maxLength={300} onChange={(e) => { setReason(e.target.value); setError(''); }} className={inputCls} placeholder="e.g. Winter vacation" />
          </div>

          {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}

          {preview && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4 space-y-2 text-sm text-gray-800 dark:text-gray-100">
              <p className="font-semibold">Preview: {fmtYmd(from)} to {fmtYmd(to)}</p>
              <ul className="space-y-1">
                <li>Returned loans affected: <span className="font-semibold">{preview.returnedLoansAffected}</span></li>
                <li>Fines that will be waived: <span className="font-semibold">{money(preview.totalWaivable)}</span></li>
                <li>Open loans affected (live fines reduce): <span className="font-semibold">{preview.openLoansAffected}</span></li>
                <li>Already paid, not refunded: <span className="font-semibold">{money(preview.paidNotRefunded)}</span></li>
              </ul>
              <p className="text-xs text-gray-600 dark:text-gray-300">Money that has already been paid is not refunded automatically. Refund it separately if needed.</p>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={doCreate} disabled={busy} className={primaryBtn}>{busy ? 'Creating…' : 'Confirm & create'}</button>
                <button type="button" onClick={invalidate} disabled={busy} className={ghostBtn}>Edit</button>
              </div>
            </div>
          )}
          {!preview && (
            <button type="button" onClick={doPreview} disabled={busy} className={primaryBtn}>{busy ? 'Checking…' : 'Preview'}</button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Existing periods</p>
          <select value={filterCampus} onChange={(e) => setFilterCampus(e.target.value)} className={`${inputCls} sm:w-56`} aria-label="Campus filter">
            <option value="">All campuses</option>
            {me?.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {failed && !loading ? (
          <div className={`${box} py-10 text-center space-y-3`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">Could not load periods.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className={primaryBtn}>Retry</button>
          </div>
        ) : loading && periods.length === 0 ? (
          <div className="space-y-3">{[1, 2].map((n) => <div key={n} className="h-20 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}</div>
        ) : periods.length === 0 ? (
          <div className={box}><EmptyState icon="document" title="No periods" description="No no-fine periods have been set." /></div>
        ) : (
          <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>{periods.map((p) => (
            <div key={p.id} className={`${box} p-4 space-y-1 ${p.cancelled ? 'opacity-70' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {fmtYmd(p.from)} to {fmtYmd(p.to)} <CampusPill code={p.campus.code} />
                  {p.cancelled && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">Cancelled</span>}
                </p>
                {!p.cancelled && <button type="button" onClick={() => setCancelling(p)} className="text-sm text-red-600 dark:text-red-300 hover:underline">Cancel period</button>}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 break-words">{p.reason}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {p.waiverCount} {p.waiverCount === 1 ? 'waiver' : 'waivers'} · {money(p.totalWaived)} waived · by {p.createdBy?.name || '—'} · {fmtDateTime(p.createdAt)}
              </p>
              {p.cancelled && <p className="text-xs text-gray-500 dark:text-gray-400">Cancelled by {p.cancelled.by?.name || '—'} · {fmtDateTime(p.cancelled.at)}: {p.cancelled.reason}</p>}
            </div>))}
          </div>
        )}
      </div>

      {cancelling && (
        <ReasonModal
          title="Cancel no-fine period"
          message={<>Live fines on books not yet returned will count these days again. Waivers already applied to returned books stay.</>}
          confirmLabel="Cancel period" danger
          onClose={() => setCancelling(null)}
          onSubmit={async (r) => {
            await cancelFinePeriod(cancelling.id, r);
            toast.success('Period cancelled');
            setCancelling(null); setRetry((n) => n + 1);
          }}
        />
      )}
    </Layout>
  );
}
