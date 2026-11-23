import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useLibrary, type LibraryDashboardData } from '../../hooks/useLibrary';
import type { LoanView } from '../../hooks/useCirculation';
import Layout from '../../components/Layout';
import { Banner, money, fmtYmd } from '../../components/CirculationBits';
import { inputCls, labelCls, primaryBtn } from '../../components/LibraryBits';

const card = 'bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5';

function LoanList({ items, count, empty, showFine }: { items: LoanView[]; count: number; empty: string; showFine?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-gray-400 dark:text-gray-500 mt-3">{empty}</p>;
  return (
    <>
      <ul className="mt-3 space-y-2">
        {items.map((l) => (
          <li key={l.id} className="text-sm border-t border-gray-100 dark:border-gray-700 pt-2 first:border-0 first:pt-0">
            <p className="text-gray-800 dark:text-gray-100 break-words">
              <Link to={`/library/students/${l.student.regNumber}`} className="font-medium hover:underline">{l.student.fullName}</Link>
              <span className="text-xs text-gray-500 dark:text-gray-400"> · {l.student.regNumber}</span>
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 break-words">
              <span className="font-mono">{l.copy.catalogNumber}</span> {l.book.title} · due {fmtYmd(l.dueDate)}
              {showFine && l.daysLate > 0 && <span className="text-red-600 dark:text-red-300 font-medium"> · {l.daysLate}d late · {money(l.lateFine)}</span>}
            </p>
          </li>
        ))}
      </ul>
      {count > items.length && <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">+ {count - items.length} more</p>}
    </>
  );
}

function Tile({ label, value, sub, to, tone }: { label: string; value: string | number; sub?: string; to?: string; tone?: 'red' | 'amber' }) {
  const body = (
    <>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === 'red' ? 'text-red-600 dark:text-red-300' : tone === 'amber' ? 'text-amber-600 dark:text-amber-300' : 'text-gray-800 dark:text-gray-100'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
    </>
  );
  return to
    ? <Link to={to} className={`${card} block hover:border-indigo-300 dark:hover:border-indigo-600`}>{body}</Link>
    : <div className={card}>{body}</div>;
}

export default function LibraryDashboard() {
  const navigate = useNavigate();
  const { me, loading, fetchMe, fetchDashboard } = useLibrary();
  const [campusId, setCampusId] = useState('');
  const [dash, setDash] = useState<LibraryDashboardData | null>(null);
  const [dashError, setDashError] = useState('');
  const [reg, setReg] = useState('');
  const [cat, setCat] = useState('');

  useEffect(() => {
    fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library'));
  }, [fetchMe]);

  const isAdmin = !!me?.isAdmin;
  const reqId = useRef(0);
  const load = useCallback(async () => {
    const mine = ++reqId.current;   // ignore stale responses when the campus changes quickly
    setDashError('');
    try {
      const d = await fetchDashboard(isAdmin && campusId ? campusId : undefined);
      if (mine === reqId.current) setDash(d);
    } catch (e: any) {
      if (mine !== reqId.current) return;
      setDash(null); setDashError(e.response?.data?.message || 'Could not load the dashboard');
    }
  }, [fetchDashboard, isAdmin, campusId]);

  useEffect(() => { if (me) load(); }, [me, load]);

  const goIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (reg.trim()) navigate(`/library/desk?reg=${encodeURIComponent(reg.trim())}`);
  };
  const goReturn = (e: React.FormEvent) => {
    e.preventDefault();
    if (cat.trim()) navigate(`/library/desk?catalog=${encodeURIComponent(cat.trim())}`);
  };

  const s = me?.settings;
  const rules: { label: string; value: string }[] = s ? [
    { label: 'Loan period', value: `${s.loanDays} days` },
    { label: 'Fine per day', value: `₹${s.finePerDay}` },
    { label: 'Max books', value: String(s.maxBooks) },
    { label: 'Max renewals', value: String(s.maxRenewals) },
    { label: 'Fine block at', value: `₹${s.fineBlockThreshold}` },
  ] : [];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Library</h2>
            {me && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {me.isAdmin
                  ? (dash?.campus?.name || (campusId ? '' : 'All campuses'))
                  : `${me.campus?.libraryName || me.campus?.name || 'Library'}${me.campus?.libraryName ? ` · ${me.campus.name}` : ''}`}
              </p>
            )}
          </div>
          {isAdmin && me && (
            <div className="sm:w-64 w-full">
              <label className={labelCls} htmlFor="dash-campus">Campus</label>
              <select id="dash-campus" value={campusId} onChange={(e) => setCampusId(e.target.value)} className={inputCls}>
                <option value="">All campuses</option>
                {me.campuses.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {loading && !me && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => <div key={n} className="h-28 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}
          </div>
        )}

        {me && (
          <div className="grid gap-4 sm:grid-cols-2">
            <form onSubmit={goIssue} className={card}>
              <label className={labelCls} htmlFor="q-reg">Issue a book: student Reg Number</label>
              <div className="flex gap-2">
                <input id="q-reg" value={reg} onChange={(e) => setReg(e.target.value)} className={`${inputCls} font-mono`} placeholder="Reg Number" autoComplete="off" />
                <button type="submit" disabled={!reg.trim()} className={primaryBtn}>Issue</button>
              </div>
            </form>
            <form onSubmit={goReturn} className={card}>
              <label className={labelCls} htmlFor="q-cat">Return a book: Catalog Number</label>
              <div className="flex gap-2">
                <input id="q-cat" value={cat} onChange={(e) => setCat(e.target.value)} className={`${inputCls} font-mono`} placeholder="e.g. IG1-00012" autoComplete="off" />
                <button type="submit" disabled={!cat.trim()} className={primaryBtn}>Return</button>
              </div>
            </form>
          </div>
        )}

        {dashError && (
          <div className="space-y-2">
            <Banner kind="error">{dashError}</Banner>
            <button type="button" onClick={load} className={primaryBtn}>Retry</button>
          </div>
        )}

        {me && !dash && !dashError && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => <div key={n} className="h-40 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}
          </div>
        )}

        {dash && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className={card}>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Due today</p>
                  <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">{dash.dueToday.count}</span>
                </div>
                <LoanList items={dash.dueToday.items} count={dash.dueToday.count} empty="Nothing due today." />
              </div>
              <div className={card}>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Due in 1-2 days</p>
                  <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">{dash.dueSoon.count}</span>
                </div>
                <LoanList items={dash.dueSoon.items} count={dash.dueSoon.count} empty="Nothing due soon." />
              </div>
              <div className={card}>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Overdue</p>
                  <span className={`text-2xl font-bold ${dash.overdue.count > 0 ? 'text-red-600 dark:text-red-300' : 'text-gray-800 dark:text-gray-100'}`}>{dash.overdue.count}</span>
                </div>
                <LoanList items={dash.overdue.items} count={dash.overdue.count} empty="No overdue books." showFine />
                {dash.overdue.count > 0 && <Link to="/library/overdue" className="inline-block text-xs text-indigo-600 dark:text-indigo-400 hover:underline mt-3">View all overdue</Link>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Tile label="Pending fines" value={money(dash.pendingFines.balance)} to="/library/fines"
                sub={`${dash.pendingFines.studentCount} ${dash.pendingFines.studentCount === 1 ? 'student' : 'students'}${dash.pendingFines.accruing > 0 ? ` · ${money(dash.pendingFines.accruing)} still accruing` : ''}`}
                tone={dash.pendingFines.balance > 0 ? 'red' : undefined} />
              <Tile label="Today's collection" value={money(dash.todayCollection.myTotal)} to="/library/payments"
                sub={`You: ${dash.todayCollection.myCount} ${dash.todayCollection.myCount === 1 ? 'receipt' : 'receipts'} · ${isAdmin && !campusId ? 'All campuses' : 'Campus'}: ${money(dash.todayCollection.campusTotal)} (${dash.todayCollection.campusCount})`} />
            </div>

            {isAdmin && dash.admin && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Tile label="Pending waivers" value={dash.admin.pendingWaivers} to="/library/waivers" tone={dash.admin.pendingWaivers > 0 ? 'amber' : undefined} />
                <Tile label="Lost copies" value={dash.admin.lostCopies} to="/library/catalog?status=LOST" />
                <Tile label="Damaged copies" value={dash.admin.damagedCopies} to="/library/catalog?status=DAMAGED" />
                <Tile label="Open stock checks" value={dash.admin.openStockChecks} to="/library/stock-check" />
              </div>
            )}
          </>
        )}

        {me && (
          <div className={card}>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Library rules</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {rules.map((r) => (
                <div key={r.label}>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{r.label}</p>
                  <p className="text-base font-semibold text-gray-800 dark:text-gray-100 mt-0.5">{r.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
