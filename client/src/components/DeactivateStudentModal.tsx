import { useEffect, useState } from 'react';
import { useClearance, type LibraryDues } from '../hooks/useClearance';

interface Props {
  open: boolean;
  studentId: string;
  studentName: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const money = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const ymd = (s: string) => { const [y, m, d] = (s || '').split('-'); return y && m && d ? `${d}-${m}-${y}` : s; };
const typeLabel = (t: string) => (t === 'LATE' ? 'Late fine' : t === 'DAMAGE' ? 'Damage' : 'Lost book');

/** Deactivate confirmation that first checks library dues (warns, never blocks). */
export default function DeactivateStudentModal({ open, studentId, studentName, loading, onConfirm, onCancel }: Props) {
  const { getLibraryDues } = useClearance();
  const [dues, setDues] = useState<LibraryDues | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setDues(null); setFailed(false); setChecking(true);
    getLibraryDues(studentId)
      .then((d) => { if (live) setDues(d); })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [open, studentId, getLibraryDues]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;
  const hasDues = !!dues && !dues.isClear;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => { if (!loading) onCancel(); }} aria-hidden="true" />
      <div role="alertdialog" aria-modal="true" aria-labelledby="deact-title"
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div>
          <h3 id="deact-title" className="text-sm font-semibold text-gray-800 dark:text-gray-100">Deactivate Student</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{studentName} will be removed from the system. All records are preserved.</p>
        </div>

        {checking && <div className="h-12 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />}

        {failed && (
          <p className="text-sm rounded-xl border border-gray-200 dark:border-gray-600 px-3 py-2 text-gray-600 dark:text-gray-300">
            Could not check library dues. You can still deactivate.
          </p>
        )}

        {hasDues && dues && (
          <div role="alert" className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-3 text-sm text-amber-900 dark:text-amber-200 space-y-2">
            <p className="font-semibold">This student has pending library dues</p>
            {dues.openLoans.length > 0 && (
              <div>
                <p className="text-xs font-medium">Books not returned</p>
                <ul className="mt-0.5 space-y-1">{dues.openLoans.map((l) => (
                  <li key={l.loanId} className="break-words">
                    {l.title} <span className="font-mono text-xs">({l.catalogNumber})</span>, {l.campus.name}
                    <span className="block text-xs">{l.isOverdue ? `Overdue since ${ymd(l.dueDate)}, ${l.daysLate} ${l.daysLate === 1 ? 'day' : 'days'} late, fine ${money(l.lateFine)}` : `Due ${ymd(l.dueDate)}`}</span>
                  </li>))}
                </ul>
              </div>
            )}
            {dues.charges.length > 0 && (
              <div>
                <p className="text-xs font-medium">Unpaid charges</p>
                <ul className="mt-0.5 space-y-1">{dues.charges.map((c) => (
                  <li key={c.chargeId} className="break-words flex justify-between gap-3">
                    <span>{typeLabel(c.type)}: {c.title} <span className="font-mono text-xs">({c.catalogNumber})</span>, {c.campus.name}</span>
                    <span className="font-semibold whitespace-nowrap">{money(c.balance)}</span>
                  </li>))}
                </ul>
              </div>
            )}
            <p className="font-semibold">Total outstanding: {money(dues.outstanding)}</p>
            <p className="text-xs">Dues stay on record and remain visible to the library.</p>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onCancel} disabled={loading}
            className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-60 border border-gray-200 dark:border-gray-600 rounded-xl">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={loading || checking}
            className="px-5 py-2.5 text-sm text-white rounded-xl font-medium disabled:opacity-60 bg-red-600 hover:bg-red-700">
            {loading ? 'Processing…' : hasDues ? 'Deactivate anyway' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}
