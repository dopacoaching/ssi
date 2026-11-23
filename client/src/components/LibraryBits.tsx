import { useState } from 'react';
import type { CopyStatus } from '../hooks/useCatalog';
import { printLabelSheet, type LabelItem } from '../utils/libraryLabels';

export const inputCls =
  'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
export const labelCls = 'block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium';
export const primaryBtn =
  'bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60';
export const ghostBtn =
  'px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-xl disabled:opacity-60';

export const STATUS_STYLES: Record<CopyStatus, string> = {
  AVAILABLE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  ISSUED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  DAMAGED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  LOST: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  WITHDRAWN: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const STATUS_LABEL: Record<CopyStatus, string> = {
  AVAILABLE: 'Available', ISSUED: 'Issued', DAMAGED: 'Damaged', LOST: 'Lost', WITHDRAWN: 'Withdrawn',
};

export function StatusChip({ status, count }: { status: CopyStatus; count?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[status]}`}>
      {count !== undefined && <span className="font-semibold">{count}</span>}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CampusPill({ code }: { code: string }) {
  return (
    <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
      {code}
    </span>
  );
}

/** Result panel: lists new catalog numbers and offers label printing with a start-at slot. */
export function PrintLabelsPanel({ title, labels, children }: { title: string; labels: LabelItem[]; children?: React.ReactNode }) {
  const [startAt, setStartAt] = useState('1');
  return (
    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">{title}</p>
      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
        {labels.map((l) => (
          <span key={l.catalogNumber} className="text-xs font-mono bg-white dark:bg-gray-800 border border-emerald-200 dark:border-emerald-800 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded-lg">
            {l.catalogNumber}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1 font-medium">Start at label (1-24)</label>
          <input type="number" min={1} max={24} value={startAt} onChange={(e) => setStartAt(e.target.value)}
            className="w-24 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <button type="button" onClick={() => printLabelSheet(labels, { startAt: Number(startAt) || 1 })} className={primaryBtn}>
          Print labels
        </button>
        {children}
      </div>
    </div>
  );
}

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
