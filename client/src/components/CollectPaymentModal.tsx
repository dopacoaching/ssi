import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useFines, type PaymentView, type StudentFines } from '../hooks/useFines';
import { inputCls, labelCls, primaryBtn, ghostBtn } from './LibraryBits';
import { Banner, money, fmtDay, fmtYmd } from './CirculationBits';
import { printReceipt } from '../utils/librarySlip';

interface Props {
  studentId: string;
  campusId?: string;
  onClose: () => void;
  onDone: (payment: PaymentView) => void;
}

const p100 = (n: number) => Math.round((Number(n) || 0) * 100);
const fromP = (p: number) => p / 100;
const newRequestId = () => {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};
const typeLabel = (t: string) => (t === 'LATE' ? 'Late fine' : t === 'DAMAGE' ? 'Damage' : 'Lost');

/** Splits `amountP` (paise) over the ticked charges, oldest first. Display convenience only. */
function autoFill(charges: StudentFines['charges'], checked: Record<string, boolean>, amountP: number) {
  const out: Record<string, string> = {};
  let left = amountP;
  for (const c of charges) {
    if (!checked[c.id]) continue;
    const give = Math.max(0, Math.min(p100(c.balance), left));
    left -= give;
    out[c.id] = give > 0 ? String(fromP(give)) : '';
  }
  return out;
}

export default function CollectPaymentModal({ studentId, campusId, onClose, onDone }: Props) {
  const { getStudentFines, createPayment } = useFines();
  const [data, setData] = useState<StudentFines | null>(null);
  const [loadError, setLoadError] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [amts, setAmts] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PaymentView | null>(null);
  const inFlight = useRef(false);
  const [retry, setRetry] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailedAfterSave, setLoadFailedAfterSave] = useState(false);
  // One id per submission; reused on retries of the identical submission so the server can de-duplicate.
  const requestId = useRef(newRequestId());
  const lastSig = useRef('');
  const dataRef = useRef<StudentFines | null>(null);
  dataRef.current = data;

  useEffect(() => {
    let live = true;
    setData(null); setLoadError('');
    getStudentFines(studentId, campusId)
      .then((d) => {
        if (!live) return;
        setData(d);
        const ck: Record<string, boolean> = {}; const am: Record<string, string> = {};
        d.charges.forEach((c) => { ck[c.id] = true; am[c.id] = String(c.balance); });
        setChecked(ck); setAmts(am);
        setAmount(String(fromP(d.charges.reduce((s, c) => s + p100(c.balance), 0))));
      })
      .catch((e: any) => { if (live) setLoadError(e.response?.data?.message || 'Could not load fines'); });
    return () => { live = false; };
  }, [studentId, campusId, getStudentFines, retry]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const charges = data?.charges ?? [];

  /** After a failed save: reload the charges before allowing another submit. */
  const refetchAfterFailure = async () => {
    setRefreshing(true);
    try {
      const d = await getStudentFines(studentId, campusId);
      const prev = dataRef.current;
      const same = !!prev && prev.charges.length === d.charges.length
        && d.charges.every((c, i) => c.id === prev.charges[i].id && p100(c.balance) === p100(prev.charges[i].balance));
      setData(d);
      if (!same) {
        const ck: Record<string, boolean> = {}; const am: Record<string, string> = {};
        d.charges.forEach((c) => { ck[c.id] = true; am[c.id] = String(c.balance); });
        setChecked(ck); setAmts(am);
        setAmount(String(fromP(d.charges.reduce((t, c) => t + p100(c.balance), 0))));
      }
    } catch {
      setError((e) => e || 'Could not reload the charges. Close and reopen to continue.');
      setLoadFailedAfterSave(true);
    } finally { setRefreshing(false); }
  };

  const onAmountChange = (v: string) => {
    setAmount(v); setError('');
    const n = Number(v);
    if (v.trim() === '' || isNaN(n) || n < 0) return;
    setAmts(autoFill(charges, checked, p100(n)));
  };

  const toggle = (id: string) => {
    const ck = { ...checked, [id]: !checked[id] };
    setChecked(ck); setError('');
    const full = charges.filter((c) => ck[c.id]).reduce((s, c) => s + p100(c.balance), 0);
    setAmount(String(fromP(full)));
    setAmts(autoFill(charges, ck, full));
  };

  const onChargeAmt = (id: string, v: string) => {
    const next = { ...amts, [id]: v };
    setAmts(next); setError('');
    const sum = charges.filter((c) => checked[c.id]).reduce((s, c) => s + (isNaN(Number(next[c.id])) ? 0 : p100(Number(next[c.id]))), 0);
    setAmount(sum > 0 ? String(fromP(sum)) : '');
  };

  const sumP = useMemo(
    () => charges.filter((c) => checked[c.id]).reduce((s, c) => s + p100(Number(amts[c.id]) || 0), 0),
    [charges, checked, amts],
  );

  const validate = (): { chargeId: string; amount: number }[] | string => {
    const total = p100(Number(amount));
    if (!(total > 0)) return 'Enter the amount received';
    const allocs: { chargeId: string; amount: number }[] = [];
    for (const c of charges) {
      if (!checked[c.id]) continue;
      const raw = amts[c.id];
      if (raw === undefined || raw === '' || Number(raw) === 0) continue;
      const a = p100(Number(raw));
      if (isNaN(Number(raw)) || a <= 0) return 'Enter valid amounts';
      if (a > p100(c.balance)) return `${c.copy.catalogNumber}: cannot exceed its balance of ${money(c.balance)}`;
      allocs.push({ chargeId: c.id, amount: fromP(a) });
    }
    if (allocs.length === 0) return 'Select at least one charge to pay';
    if (allocs.reduce((s, a) => s + p100(a.amount), 0) !== total) return 'The allocated amounts must add up to the amount received';
    return allocs;
  };

  const save = async () => {
    if (inFlight.current || !data || refreshing || loadFailedAfterSave) return;
    const v = validate();
    if (typeof v === 'string') { setError(v); return; }
    const body = {
      studentId, ...(campusId ? { campusId } : {}),
      amount: fromP(p100(Number(amount))), allocations: v, note: note.trim() || undefined,
    };
    const sig = JSON.stringify(body);
    if (sig !== lastSig.current) requestId.current = newRequestId(); // same submission => same id
    lastSig.current = sig;
    inFlight.current = true; setSaving(true); setError('');
    try {
      const payment = await createPayment({ requestId: requestId.current, ...body });
      requestId.current = newRequestId(); lastSig.current = '';
      setSaved(payment);
      toast.success(`Payment received - receipt ${payment.receiptNumber}`);
      onDone(payment);
      try { printReceipt(payment); } catch { /* user can reprint */ }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not save the payment');
      void refetchAfterFailure();
    } finally { inFlight.current = false; setSaving(false); }
  };

  const mismatch = sumP !== p100(Number(amount) || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => { if (!saving) onClose(); }} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="collect-title"
        className="relative bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="collect-title" className="text-base font-semibold text-gray-800 dark:text-gray-100">Collect payment (cash)</h3>
            {data && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{data.student.fullName} · <span className="font-mono">{data.student.regNumber}</span>{data.student.batch ? ` · ${data.student.batch.name}` : ''}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="text-2xl leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">×</button>
        </div>

        {loadError && (
          <div className="space-y-3">
            <Banner kind="error">{loadError}</Banner>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className={primaryBtn}>Retry</button>
          </div>
        )}
        {!data && !loadError && <div className="h-40 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />}

        {saved && (
          <div className="space-y-3">
            <Banner kind="success">
              <p className="font-semibold">Received {money(saved.amount)} - receipt {saved.receiptNumber}</p>
              <p className="text-xs mt-1 opacity-80">The receipt was sent to the printer. Use the button if it did not print.</p>
            </Banner>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => printReceipt(saved)} className={primaryBtn}>Print receipt</button>
              <button type="button" onClick={onClose} className={ghostBtn}>Close</button>
            </div>
          </div>
        )}

        {data && !saved && (
          <>
            {charges.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No payable charges for this student.</p>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Payable charges (oldest first). Total due <span className="font-semibold text-gray-800 dark:text-gray-100">{money(data.balance)}</span></p>
                  {charges.map((c) => (
                    <div key={c.id} className={`border rounded-xl p-3 flex flex-wrap items-center gap-3 ${checked[c.id] ? 'border-indigo-300 dark:border-indigo-700' : 'border-gray-200 dark:border-gray-700'}`}>
                      <input type="checkbox" checked={!!checked[c.id]} onChange={() => toggle(c.id)} aria-label={`Pay ${c.copy.catalogNumber}`} className="w-4 h-4" />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="text-gray-800 dark:text-gray-100 break-words"><span className="font-mono text-xs">{c.copy.catalogNumber}</span> {c.book.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{typeLabel(c.type)} · {fmtDay(c.createdAt)} · amount {money(c.amount)} · balance <span className="font-semibold">{money(c.balance)}</span></p>
                      </div>
                      <div className="w-28">
                        <input type="number" min={0} step="0.01" max={c.balance} disabled={!checked[c.id]} value={checked[c.id] ? amts[c.id] ?? '' : ''}
                          onChange={(e) => onChargeAmt(c.id, e.target.value)} className={`${inputCls} text-right`} aria-label={`Amount for ${c.copy.catalogNumber}`} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} htmlFor="cp-amount">Amount received (₹, cash)</label>
                    <input id="cp-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => onAmountChange(e.target.value)} className={`${inputCls} !text-lg font-semibold`} autoFocus />
                    <p className={`text-xs mt-1 ${mismatch ? 'text-red-600 dark:text-red-300' : 'text-gray-400 dark:text-gray-500'}`}>
                      Allocated {money(fromP(sumP))}{mismatch ? ' - must equal the amount received' : ''}
                    </p>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="cp-note">Note (optional)</label>
                    <input id="cp-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={inputCls} />
                  </div>
                </div>
              </>
            )}

            {data.accruing.length > 0 && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Accruing - payable on return</p>
                {data.accruing.map((l) => (
                  <p key={l.id} className="text-xs text-amber-800 dark:text-amber-200 break-words">
                    <span className="font-mono">{l.copy.catalogNumber}</span> {l.book.title} · due {fmtYmd(l.dueDate)} · {l.daysLate} days late · {money(l.lateFine)} so far
                  </p>
                ))}
              </div>
            )}

            {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} disabled={saving} className={ghostBtn}>Cancel</button>
              <button type="button" onClick={save} disabled={saving || refreshing || loadFailedAfterSave || charges.length === 0} className={primaryBtn}>
                {saving ? 'Saving…' : refreshing ? 'Refreshing…' : `Receive ${money(Number(amount) || 0)} & print`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
