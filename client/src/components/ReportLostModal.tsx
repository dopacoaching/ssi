import { useEffect, useRef, useState } from 'react';
import { useCirculation, type LoanView, type ReportLostResult } from '../hooks/useCirculation';
import { inputCls, labelCls, ghostBtn } from './LibraryBits';
import { Banner, money } from './CirculationBits';
import { BackdateControl, backdatePayload, noBackdate, type Backdate } from './Backdate';

interface Props {
  loan: LoanView;
  /** Book price if the caller knows it (the Desk copy card does); falls back to loan.book.price. */
  price?: number | null;
  isAdmin: boolean;
  onClose: () => void;
  onDone: (r: ReportLostResult) => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function ReportLostModal({ loan, price, isAdmin, onClose, onDone }: Props) {
  const { reportLost } = useCirculation();
  const bookPrice = (loan.book as { price?: number | null }).price ?? price ?? null;
  const [amount, setAmount] = useState(bookPrice != null ? String(bookPrice) : '');
  const [note, setNote] = useState('');
  const [backdate, setBackdate] = useState<Backdate>(noBackdate);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const n = amount.trim() === '' ? NaN : Number(amount);
  const valid = !isNaN(n) && n >= 0;
  const changed = bookPrice != null ? !valid || round2(n) !== round2(bookPrice) : false;
  const total = round2(loan.lateFine + (valid ? n : 0));

  const submit = async () => {
    if (inFlight.current) return;
    if (!valid) { setError(bookPrice == null ? 'Enter the lost-book charge (this book has no price on record)' : 'Enter a valid lost-book charge (0 or more)'); return; }
    if (changed && !note.trim()) { setError('A note is required when the charge differs from the book price'); return; }
    const bd = backdatePayload(backdate, 'lostAt');
    if ('error' in bd) { setError(bd.error); return; }
    inFlight.current = true; setBusy(true); setError('');
    try {
      const r = await reportLost({ loanId: loan.id, amount: n, ...(note.trim() ? { note: note.trim() } : {}), ...bd.fields });
      onDone(r);
    } catch (e: any) { setError(e.response?.data?.message || 'Could not report the book lost'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => { if (!busy) onClose(); }} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="rl-title" className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <h3 id="rl-title" className="text-base font-semibold text-gray-800 dark:text-gray-100">Report lost: {loan.copy.catalogNumber}</h3>
        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-0.5">
          <p className="break-words font-medium text-gray-800 dark:text-gray-100">{loan.book.title}</p>
          <p>{loan.student.fullName} · <span className="font-mono">{loan.student.regNumber}</span></p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-gray-400 dark:text-gray-500">Late fine so far</dt><dd className="font-semibold text-gray-800 dark:text-gray-100">{money(loan.lateFine)}{loan.daysLate > 0 ? ` (${loan.daysLate}d)` : ''}</dd></div>
          <div><dt className="text-xs text-gray-400 dark:text-gray-500">Book price</dt><dd className="font-semibold text-gray-800 dark:text-gray-100">{bookPrice != null ? money(bookPrice) : 'Not on record'}</dd></div>
        </dl>
        <div>
          <label className={labelCls} htmlFor="rl-amt">Lost-book charge (₹)</label>
          <input id="rl-amt" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} autoFocus />
        </div>
        <div>
          <label className={labelCls} htmlFor="rl-note">Note{changed ? ' (required, charge differs from price)' : ' (optional)'}</label>
          <textarea id="rl-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-200">Total due: <span className="font-bold">{money(total)}</span></p>
        {isAdmin && <BackdateControl value={backdate} onChange={setBackdate} label="Lost at" />}
        {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={busy} className={ghostBtn}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="px-5 py-2.5 text-sm text-white rounded-xl font-medium disabled:opacity-60 bg-red-600 hover:bg-red-700">
            {busy ? 'Processing…' : 'Report lost'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LostResultBanner({ result, onCollect, onClose }: { result: ReportLostResult; onCollect: () => void; onClose: () => void }) {
  const sum = (t: string) => result.charges.filter((c) => c.type === t).reduce((s, c) => s + c.amount, 0);
  return (
    <Banner kind="success" onClose={onClose}>
      <p className="font-semibold">Reported lost: {result.loan.copy.catalogNumber}{result.loan.book ? ` "${result.loan.book.title}"` : ""}{result.student ? ` (${result.student.fullName})` : ""}</p>
      <p className="mt-1">
        Late fine: <span className="font-semibold">{money(sum('LATE'))}</span>
        {' · '}Lost charge: <span className="font-semibold">{money(sum('LOST'))}</span>
        {result.student && <>{' · '}Student's outstanding: <span className="font-semibold">{money(result.student.outstanding)}</span></>}
      </p>
      {result.student && result.charges.length > 0 && result.student.outstanding > 0 && (
        <button type="button" onClick={onCollect} className="mt-3 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700">Collect payment</button>
      )}
    </Banner>
  );
}
