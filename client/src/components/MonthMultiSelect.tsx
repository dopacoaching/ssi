import { useState, useRef, useEffect } from 'react';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Props {
  selectedMonths: number[];
  onMonthsChange: (months: number[]) => void;
  year?: string;
  onYearChange?: (year: string) => void;
  placeholder?: string;
  className?: string;
}

export default function MonthMultiSelect({
  selectedMonths,
  onMonthsChange,
  year,
  onYearChange,
  placeholder = 'All Months',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  function toggle(m: number) {
    onMonthsChange(
      selectedMonths.includes(m)
        ? selectedMonths.filter((x) => x !== m)
        : [...selectedMonths, m].sort((a, b) => a - b)
    );
  }

  const label =
    selectedMonths.length === 0
      ? placeholder
      : selectedMonths.map((m) => MONTHS[m]).join(', ') +
        (year ? ` ${year}` : '');

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 rounded-xl px-2.5 py-1.5 text-xs font-medium hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 max-w-52 transition-colors"
      >
        <svg className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="truncate">{label}</span>
        <svg
          className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-3 w-56">
          {onYearChange !== undefined && (
            <div className="mb-3 pb-2.5 border-b border-gray-100 dark:border-gray-700">
              <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5">
                Year
              </label>
              <input
                type="number"
                value={year ?? ''}
                onChange={(e) => onYearChange(e.target.value)}
                placeholder="All years"
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                Months
              </span>
              {selectedMonths.length > 0 && (
                <button
                  type="button"
                  onClick={() => onMonthsChange([])}
                  className="text-[10px] text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 font-semibold"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggle(m)}
                  className={`text-[11px] py-1.5 rounded-lg font-semibold transition-colors ${
                    selectedMonths.includes(m)
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400'
                  }`}
                >
                  {MONTHS[m]}
                </button>
              ))}
            </div>
          </div>

          {selectedMonths.length > 0 && (
            <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium mt-2.5 pt-2 border-t border-gray-100 dark:border-gray-700">
              {selectedMonths.length} month{selectedMonths.length !== 1 ? 's' : ''} selected
            </p>
          )}
        </div>
      )}
    </div>
  );
}
