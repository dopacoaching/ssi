import { Link } from 'react-router-dom';
import type { LoanView, OtherCampusSummary, StudentCard } from '../hooks/useCirculation';
import { fmtYmd } from '../utils/librarySlip';

export const money = (n: number | null | undefined) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export { fmtYmd };

export const conditionLabel = (c: LoanView['condition']) =>
  c === 'GOOD' ? 'Good' : c === 'DAMAGED_MINOR' ? 'Damaged (minor)' : c === 'DAMAGED_MAJOR' ? 'Damaged (major)' : '—';

export function Banner({ kind, children, onClose }: { kind: 'success' | 'error' | 'info'; children: React.ReactNode; onClose?: () => void }) {
  const cls = kind === 'success'
    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
    : kind === 'error'
      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
      : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`border rounded-2xl p-4 text-sm flex items-start gap-3 ${cls}`}>
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-60 hover:opacity-100 text-lg leading-none">×</button>}
    </div>
  );
}

export function OverdueChip({ days }: { days?: number }) {
  return (
    <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
      Overdue{days ? ` ${days}d` : ''}
    </span>
  );
}

export function Avatar({ name, photo, size = 56 }: { name: string; photo?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  return photo ? (
    <img src={photo} alt={name} style={{ width: size, height: size }} className="rounded-full object-cover flex-shrink-0" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-semibold flex-shrink-0">
      {initials || '?'}
    </div>
  );
}

export function OtherCampusLine({ o }: { o: OtherCampusSummary | null }) {
  if (!o || (!o.openLoans && !o.outstanding)) return null;
  return (
    <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
      Other campuses ({o.campuses.join(', ')}): {o.openLoans} open {o.openLoans === 1 ? 'loan' : 'loans'}
      {o.overdueLoans > 0 && <>, <span className="font-semibold text-red-600 dark:text-red-300">{o.overdueLoans} overdue</span></>}
      , outstanding {money(o.outstanding)}
    </p>
  );
}

export function LoanLine({ l, showStudent, onReportLost }: { l: LoanView; showStudent?: boolean; onReportLost?: (l: LoanView) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-mono text-xs text-gray-700 dark:text-gray-200">{l.copy.catalogNumber}</span>
      <Link to={`/library/books/${l.book.id}`} className="font-medium text-gray-800 dark:text-gray-100 hover:underline break-words">{l.book.title}</Link>
      {showStudent && <span className="text-xs text-gray-500 dark:text-gray-400">{l.student.fullName}</span>}
      <span className={`text-xs ${l.isOverdue ? 'text-red-600 dark:text-red-300 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
        Due {fmtYmd(l.dueDate)}
        {l.isOverdue && ` · ${l.daysLate} ${l.daysLate === 1 ? 'day' : 'days'} late · fine ${money(l.lateFine)}`}
      </span>
      {l.isOverdue && <OverdueChip />}
      {onReportLost && l.status === 'OPEN' && (
        <button type="button" onClick={() => onReportLost(l)} className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Report lost</button>
      )}
      {(l.waivedDays ?? 0) > 0 && <WaivedDaysNote days={l.waivedDays!} />}
    </div>
  );
}

export function WaivedDaysNote({ days }: { days: number }) {
  return <span className="text-xs text-emerald-700 dark:text-emerald-300">{days} {days === 1 ? 'day' : 'days'} waived (no-fine period)</span>;
}

/** Student summary used by the Desk and the student library page. */
export function StudentSummary({ card, showEligibility = true, onCollect, onReportLost }: { card: StudentCard; showEligibility?: boolean; onCollect?: () => void; onReportLost?: (l: LoanView) => void }) {
  const { student: s, eligibility: e, settings, outstanding, loans, otherCampuses } = card;
  const free = Math.max(0, settings.maxBooks - loans.length);
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Avatar name={s.fullName} photo={s.photo} />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-gray-800 dark:text-gray-100 break-words">{s.fullName}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-mono">{s.regNumber}</span> · {s.batch?.name || 'No batch'}{s.campus ? ` · ${s.campus.name}` : ''}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.isActive
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
          {s.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Current books ({loans.length} of {settings.maxBooks})</p>
        {loans.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No books on loan here.</p>
        ) : (
          <div className="space-y-1.5">{loans.map((l) => <LoanLine key={l.id} l={l} onReportLost={onReportLost} />)}</div>
        )}
      </div>

      <div className="text-sm text-gray-700 dark:text-gray-200">
        Outstanding: <span className={`font-semibold ${outstanding.thisCampus > 0 ? 'text-red-600 dark:text-red-300' : ''}`}>{money(outstanding.thisCampus)}</span> here
        <span className="text-gray-400 dark:text-gray-500"> · </span>
        <span className="font-semibold">{money(outstanding.total)}</span> total
        {onCollect && outstanding.thisCampus > 0 && card.charges.length > 0 && (
          <button type="button" onClick={onCollect} className="ml-3 bg-indigo-600 text-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-indigo-700">Collect</button>
        )}
      </div>
      <OtherCampusLine o={otherCampuses} />

      {showEligibility && (e.canIssue ? (
        <div className="rounded-xl px-3 py-2 text-sm font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">
          Can borrow ({free} of {settings.maxBooks} slots free)
        </div>
      ) : (
        <div className="rounded-xl px-3 py-2 text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
          <p className="font-medium">Cannot issue:</p>
          <ul className="list-disc pl-5 mt-0.5 space-y-0.5">{e.reasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

/** Borrower + due date for an ISSUED copy (catalog / book detail). */
export function CopyLoanInfo({ loan }: { loan: NonNullable<import('../hooks/useCatalog').BookCopy['loan']> }) {
  return (
    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={loan.isOverdue ? 'text-red-600 dark:text-red-300 font-medium' : ''}>Due {fmtYmd(loan.dueDate)}</span>
        {loan.isOverdue && <OverdueChip days={loan.daysLate} />}
        {loan.isOverdue && (loan.lateFine ?? 0) > 0 && <span>fine {money(loan.lateFine)}</span>}
      </div>
      {(loan.waivedDays ?? 0) > 0 && <WaivedDaysNote days={loan.waivedDays!} />}
      <Link to={`/library/students/${loan.student.regNumber}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
        {loan.student.fullName} ({loan.student.regNumber})
      </Link>
    </div>
  );
}
