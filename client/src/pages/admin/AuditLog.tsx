import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { useAudit, AuditFilters } from '../../hooks/useAudit';

const ACTIONS  = ['CREATE', 'UPDATE', 'DELETE'];
const ENTITIES = ['Student', 'WeeklyTest', 'MonthlyTest', 'CERecord', 'Batch', 'Teacher', 'Remark', 'BatchApproval'];
const PAGE_SIZE = 50;

const inputCls = 'border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';

const ACTION_BADGE: Record<string, string> = {
  CREATE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  UPDATE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const ROLE_BADGE: Record<string, string> = {
  ADMIN:   'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400',
  TEACHER: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
};

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AuditLogPage() {
  const { items, total, loading, fetch } = useAudit();

  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [action, setAction]     = useState('');
  const [entity, setEntity]     = useState('');
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');

  const load = useCallback((p: number, filters: Partial<AuditFilters> = {}) => {
    fetch({ page: p, limit: PAGE_SIZE, ...filters });
  }, [fetch]);

  useEffect(() => {
    load(1, { search, action, entity, from, to });
    setPage(1);
  }, [search, action, entity, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  function changePage(next: number) {
    setPage(next);
    load(next, { search, action, entity, from, to });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <Link to="/" className="text-sm text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium">← Dashboard</Link>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mt-2">Audit Log</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track every create, update, and delete action across the system</p>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input
              type="text"
              placeholder="Search user or description…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`${inputCls} lg:col-span-2`}
            />
            <select value={action} onChange={e => setAction(e.target.value)} className={inputCls}>
              <option value="">All actions</option>
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={entity} onChange={e => setEntity(e.target.value)} className={inputCls}>
              <option value="">All entities</option>
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <div className="flex gap-2">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className={`${inputCls} flex-1`} title="From date" />
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className={`${inputCls} flex-1`} title="To date" />
            </div>
          </div>
          {(search || action || entity || from || to) && (
            <button
              onClick={() => { setSearch(''); setAction(''); setEntity(''); setFrom(''); setTo(''); }}
              className="mt-3 text-xs text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 font-medium"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {loading ? 'Loading…' : `${total.toLocaleString()} log entr${total === 1 ? 'y' : 'ies'}`}
            </p>
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span>Page {page} of {totalPages}</span>
              <button
                onClick={() => changePage(page - 1)} disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors text-xs font-medium"
              >Prev</button>
              <button
                onClick={() => changePage(page + 1)} disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors text-xs font-medium"
              >Next</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-40">Time</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-36">User</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-20">Action</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-32">Entity</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                      No audit entries found.
                    </td>
                  </tr>
                )}
                {items.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap font-mono">
                      {fmt(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 leading-tight">{entry.userName}</p>
                      <span className={`inline-block mt-0.5 text-xs px-1.5 py-0.5 rounded-md font-semibold ${ROLE_BADGE[entry.userRole] ?? ''}`}>
                        {entry.userRole}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs px-2 py-1 rounded-lg font-semibold ${ACTION_BADGE[entry.action] ?? 'bg-gray-100 text-gray-600'}`}>
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">
                      {entry.entity}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {entry.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-100 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
              <span>Page {page} of {totalPages}</span>
              <button
                onClick={() => changePage(page - 1)} disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors text-xs font-medium"
              >Prev</button>
              <button
                onClick={() => changePage(page + 1)} disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors text-xs font-medium"
              >Next</button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
