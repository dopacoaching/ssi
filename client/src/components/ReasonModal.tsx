import { useEffect, useRef, useState } from 'react';
import { inputCls, labelCls, ghostBtn } from './LibraryBits';
import { Banner } from './CirculationBits';

interface Props {
  title: string;
  message?: React.ReactNode;
  label?: string;
  required?: boolean;
  confirmLabel: string;
  danger?: boolean;
  /** Optional extra fields rendered above the reason box. */
  children?: React.ReactNode;
  /** Return an error string to block submit before any request. */
  validate?: () => string | null;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}

/** Modal with a reason box (void / reject / cancel / approve-with-note). */
export default function ReasonModal({ title, message, label = 'Reason', required = true, confirmLabel, danger, children, validate, onSubmit, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async () => {
    if (inFlight.current) return;
    if (required && !reason.trim()) { setError(`${label} is required`); return; }
    const v = validate?.();
    if (v) { setError(v); return; }
    inFlight.current = true; setBusy(true); setError('');
    try { await onSubmit(reason.trim()); }
    catch (e: any) { setError(e.response?.data?.message || 'Something went wrong'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => { if (!busy) onClose(); }} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="rm-title" className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h3 id="rm-title" className="text-base font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
        {message && <div className="text-sm text-gray-600 dark:text-gray-300">{message}</div>}
        {children}
        <div>
          <label className={labelCls} htmlFor="rm-reason">{label}{required ? ' (required)' : ' (optional)'}</label>
          <textarea id="rm-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} autoFocus />
        </div>
        {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={busy} className={ghostBtn}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy}
            className={`px-5 py-2.5 text-sm text-white rounded-xl font-medium disabled:opacity-60 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
            {busy ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
