import { useState, useEffect, FormEvent } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { useCE, CERecord } from '../hooks/useCE';
import { RootState } from '../store';

interface Props {
  studentId: string;
  existingRecords?: CERecord[];
  onSaved: () => void;
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';

function blankForm(month: number, year: number) {
  return {
    month: month.toString(), year: year.toString(),
    attendancePct: '',
    hasMedCert: false,
    notesStatus: 'COMPLETE' as 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE',
  };
}

function recordToForm(r: CERecord) {
  return {
    month: r.month.toString(), year: r.year.toString(),
    attendancePct: r.attendancePct.toString(),
    hasMedCert: r.hasMedCert,
    notesStatus: r.notesStatus,
  };
}

export default function CEForm({ studentId, existingRecords = [], onSaved }: Props) {
  const { upsert } = useCE(studentId);
  const user = useSelector((s: RootState) => s.auth.user);
  const now = new Date();

  const [form, setForm] = useState(() => blankForm(now.getMonth() + 1, now.getFullYear()));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const m = Number(form.month);
    const y = Number(form.year);
    if (!m || !y) return;
    const existing = existingRecords.find((r) => r.month === m && r.year === y);
    if (existing) setForm(recordToForm(existing));
    else setForm((f) => ({ ...blankForm(m, y), month: f.month, year: f.year }));
  }, [form.month, form.year, existingRecords]);

  const matchedRecord = existingRecords.find(
    (r) => r.month === Number(form.month) && r.year === Number(form.year)
  );
  const isLocked = matchedRecord?.isApproved && user?.role === 'TEACHER';

  function set(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isLocked) {
      toast.error('This month has been approved by admin and is locked');
      return;
    }
    const n = new Date();
    const y = Number(form.year), m = Number(form.month);
    if (y > n.getFullYear() || (y === n.getFullYear() && m > n.getMonth() + 1)) {
      toast.error('Cannot add CE records for a future month');
      return;
    }
    setSaving(true);
    try {
      await upsert({
        month: m, year: y,
        attendancePct: Number(form.attendancePct),
        hasMedCert: form.hasMedCert,
        notesStatus: form.notesStatus,
      });
      toast.success('Attendance & Notes updated');
      onSaved();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update record');
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-4 sm:p-5 mb-4 space-y-4">
      {isLocked && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
          <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>This month has been approved by admin and is locked for editing.</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Attendance & Notes</h3>
        {matchedRecord && (
          <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
            Editing {MONTHS[matchedRecord.month]} {matchedRecord.year}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Month (1–12)</label>
          <input type="number" required min={1} max={12} value={form.month} disabled={isLocked}
            onChange={(e) => set('month', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Year</label>
          <input type="number" required value={form.year} disabled={isLocked}
            onChange={(e) => set('year', e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Attendance % (0–100)</label>
          <input type="number" required min={0} max={100} value={form.attendancePct} disabled={isLocked}
            onChange={(e) => set('attendancePct', e.target.value)} className={inputCls} />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input type="checkbox" id="medcert" checked={form.hasMedCert} disabled={isLocked}
            onChange={(e) => set('hasMedCert', e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60" />
          <label htmlFor="medcert" className="text-xs text-gray-600 dark:text-gray-400">Has Medical Certificate (+0.5 mitigation)</label>
        </div>

        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Notes Status</label>
          <select value={form.notesStatus} onChange={(e) => set('notesStatus', e.target.value)} disabled={isLocked}
            className={inputCls}>
            <option value="COMPLETE">Complete (2pt)</option>
            <option value="PARTIAL">Partial (1pt)</option>
            <option value="INCOMPLETE">Incomplete (0pt)</option>
          </select>
        </div>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Theory &amp; MCQ scores are calculated automatically from the weekly and monthly test records.
      </p>

      <button type="submit" disabled={saving || isLocked} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
        {saving ? 'Saving…' : 'Save Attendance & Notes'}
      </button>
    </form>
  );
}
