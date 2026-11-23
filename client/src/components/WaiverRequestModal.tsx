import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useFines, type WaiverView } from '../hooks/useFines';
import type { ChargeView } from '../hooks/useCirculation';
import { inputCls, labelCls, primaryBtn, ghostBtn } from './LibraryBits';
import { Banner, money } from './CirculationBits';

interface Props {
  charge: ChargeView;
  isAdmin: boolean;
  onClose: () => void;
  onDone: (w: WaiverView) => void;
}

export default function WaiverRequestModal({ charge, isAdmin, onClose, onDone }: Props) {
  const { requestWaiver } = useFines();
  const [amount, setAmount] = useState(String(charge.balance));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const submit = async () => {
    if (inFlight.current) return;
    const n = Number(amount);
    if (!(n > 0)) { setError('Enter an amount greater than zero'); return; }
    if (Math.round(n * 100) > Math.round(charge.balance * 100)) { setError(`Cannot exceed the balance of ${money(charge.balance)}`); return; }
    if (!reason.trim()) { setError('A reason is required'); return; }
    inFlight.current = true; setSaving(true); setError('');
    try {
      const w = await requestWaiver({ chargeId: charge.id, amount: Math.round(n * 100) / 100, reason: reason.trim() });
      toast.success(isAdmin ? 'Waived' : 'Waiver requested');
      onDone(w);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not submit');
    } finally { inFlight.current = false; setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => { if (!saving) onClose(); }} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="wr-title" className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h3 id="wr-title" className="text-base font-semibold text-gray-800 dark:text-gray-100">{isAdmin ? 'Waive charge now' : 'Request waiver'}</h3>
        <div className="text-sm border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-gray-700 dark:text-gray-200">
          <p className="font-medium">{charge.type === 'LATE' ? 'Late fine' : charge.type === 'DAMAGE' ? 'Damage' : 'Lost'} · <span className="font-mono text-xs">{charge.copy.catalogNumber}</span> {charge.book.title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Amount {money(charge.amount)} · balance <span className="font-semibold">{money(charge.balance)}</span></p>
        </div>
        <div>
          <label className={labelCls} htmlFor="wr-amount">Amount to waive (₹, max {money(charge.balance)})</label>
          <input id="wr-amount" type="number" min={0} step="0.01" max={charge.balance} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="wr-reason">Reason (required)</label>
          <textarea id="wr-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </div>
        {!isAdmin && <p className="text-xs text-gray-500 dark:text-gray-400">An admin will review this request.</p>}
        {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={saving} className={ghostBtn}>Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className={primaryBtn}>{saving ? 'Saving…' : isAdmin ? 'Waive now' : 'Submit request'}</button>
        </div>
      </div>
    </div>
  );
}
