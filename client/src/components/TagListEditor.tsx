import { useState } from 'react';

interface Props {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}

export default function TagListEditor({ label, values, onChange, placeholder, hint, disabled }: Props) {
  const [draft, setDraft] = useState('');

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft('');
  }

  return (
    <div>
      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">{label}</label>
      <div className="flex gap-2">
        <input
          value={draft}
          disabled={disabled}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 min-w-0 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || !draft.trim()}
          className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium disabled:opacity-60"
        >
          Add
        </button>
      </div>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{hint}</p>}
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
              {v}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                className="w-4 h-4 rounded-full flex items-center justify-center text-indigo-500 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 leading-none"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2.5">None added yet</p>
      )}
    </div>
  );
}
