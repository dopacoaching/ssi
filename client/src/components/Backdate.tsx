import { inputCls, labelCls } from './LibraryBits';

export const nowLocal = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export interface Backdate { on: boolean; at: string; reason: string }
export const noBackdate: Backdate = { on: false, at: '', reason: '' };

export function BackdateControl({ value, onChange, label }: { value: Backdate; onChange: (b: Backdate) => void; label: string }) {
  return (
    <div className="space-y-2">
      <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked, at: e.target.checked ? value.at || nowLocal() : '' })} />
        Backdate…
      </label>
      {value.on && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{label} (max 30 days back)</label>
            <input type="datetime-local" value={value.at} max={nowLocal()} onChange={(e) => onChange({ ...value, at: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Reason (required)</label>
            <input value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })} className={inputCls} placeholder="Why is this backdated?" />
          </div>
        </div>
      )}
    </div>
  );
}

/** Returns an error string, or the payload fields to merge. */
export function backdatePayload(b: Backdate, key: 'issuedAt' | 'returnedAt' | 'lostAt'): { error: string } | { fields: Record<string, string> } {
  if (!b.on) return { fields: {} };
  if (!b.at) return { error: 'Choose the backdated date and time' };
  if (!b.reason.trim()) return { error: 'A reason is required for backdating' };
  const d = new Date(b.at);
  if (isNaN(d.getTime())) return { error: 'Invalid date' };
  return { fields: { [key]: d.toISOString(), reason: b.reason.trim() } };
}
