import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import EmptyState from '../../components/EmptyState';
import ReasonModal from '../../components/ReasonModal';
import { useLibrary } from '../../hooks/useLibrary';
import { useFines, type WaiverStatus, type WaiverView } from '../../hooks/useFines';
import { inputCls, labelCls, primaryBtn, ghostBtn, CampusPill, fmtDateTime } from '../../components/LibraryBits';
import { money } from '../../components/CirculationBits';

const LIMIT = 25;
const box = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl';
type Tab = WaiverStatus | '';
const TABS: { key: Tab; label: string }[] = [
  { key: 'PENDING', label: 'Pending' }, { key: 'APPROVED', label: 'Approved' }, { key: 'REJECTED', label: 'Rejected' }, { key: '', label: 'All' },
];
const STATUS_STYLE: Record<WaiverStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  APPROVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  REJECTED: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};
const chargeType = (t: string) => (t === 'LATE' ? 'Late fine' : t === 'DAMAGE' ? 'Damage' : 'Lost');

export default function Waivers() {
  const { me, fetchMe } = useLibrary();
  const { listWaivers, approveWaiver, rejectWaiver } = useFines();

  const [tab, setTab] = useState<Tab>('PENDING');
  const [mine, setMine] = useState(false);
  const [campusId, setCampusId] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<WaiverView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [approving, setApproving] = useState<WaiverView | null>(null);
  const [rejecting, setRejecting] = useState<WaiverView | null>(null);
  const [apAmount, setApAmount] = useState('');
  const reqId = useRef(0);

  useEffect(() => { fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library')); }, [fetchMe]);
  const isAdmin = !!me?.isAdmin;

  useEffect(() => {
    if (!me) return;
    const id = ++reqId.current;
    setLoading(true); setFailed(false);
    listWaivers({ status: tab, mine: mine || undefined, campusId: isAdmin ? campusId : undefined, page, limit: LIMIT })
      .then((r) => { if (id === reqId.current) { setItems(r.items); setTotal(r.total); } })
      .catch((e: any) => { if (id === reqId.current) { setFailed(true); setItems([]); setTotal(0); toast.error(e.response?.data?.message || 'Failed to load waivers'); } })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [me, listWaivers, tab, mine, campusId, page, isAdmin, retry]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const showCampus = isAdmin && !campusId;

  const openApprove = (w: WaiverView) => { setApAmount(String(w.amount)); setApproving(w); };

  const card = (w: WaiverView) => (
    <div key={w.id} className={`${box} p-4 space-y-2`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/library/students/${w.student.regNumber}`} className="text-sm font-semibold text-gray-800 dark:text-gray-100 hover:underline">{w.student.fullName}</Link>
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400"> {w.student.regNumber}</span> {showCampus && <CampusPill code={w.campus.code} />}
        </div>
        <div className="flex items-center gap-2">
          {w.type !== 'REQUEST' && <span className="text-xs text-gray-500 dark:text-gray-400">{w.type === 'BULK' ? 'No-fine period' : 'Direct'}</span>}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[w.status]}`}>{w.status}</span>
        </div>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-200 break-words">
        {chargeType(w.charge.type)} · <span className="font-mono text-xs">{w.charge.copy.catalogNumber}</span> {w.charge.book.title}
        <span className="text-xs text-gray-500 dark:text-gray-400"> · charge {money(w.charge.amount)}, balance {money(w.charge.balance)}</span>
      </p>
      <p className="text-sm text-gray-800 dark:text-gray-100">
        {w.status === 'APPROVED' ? 'Waived' : 'Requested'} <span className="font-semibold">{money(w.status === 'APPROVED' ? w.approvedAmount ?? w.amount : w.amount)}</span>
        {w.status === 'APPROVED' && w.approvedAmount != null && w.approvedAmount !== w.amount && <span className="text-xs text-gray-500 dark:text-gray-400"> (requested {money(w.amount)})</span>}
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-300 break-words">Reason: {w.reason}</p>
      {w.decisionNote && <p className="text-xs text-gray-500 dark:text-gray-400 break-words">Decision note: {w.decisionNote}</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        By {w.requestedBy?.name || '—'} · {fmtDateTime(w.requestedAt)}
        {w.decidedAt && <> · decided by {w.decidedBy?.name || '—'} · {fmtDateTime(w.decidedAt)}</>}
      </p>
      {isAdmin && w.status === 'PENDING' && (
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => openApprove(w)} className={`${primaryBtn} !py-1.5 !px-3`}>Approve</button>
          <button type="button" onClick={() => setRejecting(w)} className={`${ghostBtn} !py-1.5 !px-3 !text-red-600 dark:!text-red-300`}>Reject</button>
        </div>
      )}
    </div>
  );

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Waivers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{total} {total === 1 ? 'waiver' : 'waivers'}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button key={t.label} type="button" aria-pressed={tab === t.key} onClick={() => { setTab(t.key); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === t.key ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700'}`}>
              {t.label}
            </button>
          ))}
          <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer ml-auto">
            <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} /> Mine
          </label>
          {isAdmin && me && (
            <select value={campusId} onChange={(e) => { setCampusId(e.target.value); setPage(1); }} className={`${inputCls} sm:w-52`} aria-label="Campus">
              <option value="">All campuses</option>
              {me.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {failed && !loading ? (
          <div className={`${box} py-10 text-center space-y-3`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">Could not load waivers.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className={primaryBtn}>Retry</button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-28 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}</div>
        ) : items.length === 0 ? (
          <div className={box}><EmptyState icon="document" title="No waivers" description="Nothing in this view." /></div>
        ) : (
          <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>{items.map(card)}</div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={ghostBtn}>Previous</button>
            <span className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className={ghostBtn}>Next</button>
          </div>
        )}
      </div>

      {approving && (
        <ReasonModal
          title="Approve waiver" label="Note" required={false} confirmLabel="Approve"
          message={<>{approving.student.fullName} · {chargeType(approving.charge.type)} {approving.charge.copy.catalogNumber}. Requested {money(approving.amount)}; current balance {money(approving.charge.balance)}.</>}
          validate={() => {
            const n = Number(apAmount);
            if (apAmount.trim() === '' || !(n > 0)) return 'Enter an amount greater than zero';
            if (Math.round(n * 100) > Math.round(approving.amount * 100)) return `Cannot exceed the requested ${money(approving.amount)}`;
            return null;
          }}
          onClose={() => setApproving(null)}
          onSubmit={async (note) => {
            const n = Math.round(Number(apAmount) * 100) / 100;
            const result = await approveWaiver(approving.id, { ...(n !== approving.amount ? { amount: n } : {}), ...(note ? { note } : {}) });
            if (result.closed) toast(result.message || 'Nothing left to waive — the charge is already settled, so the request was closed');
            else toast.success('Waiver approved');
            setApproving(null); setRetry((x) => x + 1);
          }}
        >
          <div>
            <label className={labelCls} htmlFor="ap-amount">Amount to waive (₹, optionally lower)</label>
            <input id="ap-amount" type="number" min={0} step="0.01" max={approving.amount} value={apAmount} onChange={(e) => setApAmount(e.target.value)} className={inputCls} />
          </div>
        </ReasonModal>
      )}

      {rejecting && (
        <ReasonModal
          title="Reject waiver" label="Note" confirmLabel="Reject" danger
          message={<>{rejecting.student.fullName} · {chargeType(rejecting.charge.type)} {rejecting.charge.copy.catalogNumber} · {money(rejecting.amount)}</>}
          onClose={() => setRejecting(null)}
          onSubmit={async (note) => {
            await rejectWaiver(rejecting.id, note);
            toast.success('Waiver rejected');
            setRejecting(null); setRetry((x) => x + 1);
          }}
        />
      )}
    </Layout>
  );
}
