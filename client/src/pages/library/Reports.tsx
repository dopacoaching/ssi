import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import { useLibrary } from '../../hooks/useLibrary';
import { useReports, type ReportResult } from '../../hooks/useReports';
import { Banner } from '../../components/CirculationBits';
import { inputCls, labelCls, primaryBtn, ghostBtn } from '../../components/LibraryBits';
import { exportReportExcel, exportReportPDF, fmtReportCell } from '../../utils/libraryExport';

const card = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4';

interface ReportDef {
  type: string; label: string; adminOnly?: boolean;
  dates?: string;           // hint shown when the report uses a date range
  extra?: 'group-fines' | 'group-borrowing' | 'status' | 'limit' | 'months';
}

const REPORTS: ReportDef[] = [
  { type: 'stock-summary', label: 'Stock summary' },
  { type: 'issued', label: 'Books issued (open loans)' },
  { type: 'overdue', label: 'Overdue books' },
  { type: 'fine-collection', label: 'Fine collection', dates: 'Default: this month', extra: 'group-fines' },
  { type: 'pending-fines', label: 'Pending fines' },
  { type: 'waivers', label: 'Waivers', dates: 'Default: this month', extra: 'status' },
  { type: 'lost-damaged', label: 'Lost and damaged', dates: 'Default: this year' },
  { type: 'most-borrowed', label: 'Most borrowed books', dates: 'Default: last 12 months', extra: 'limit' },
  { type: 'never-borrowed', label: 'Never borrowed books', extra: 'months' },
  { type: 'student-borrowing', label: 'Student borrowing', dates: 'Default: last 12 months', extra: 'group-borrowing' },
  { type: 'campus-comparison', label: 'Campus comparison', adminOnly: true, dates: 'Default: this month (flows)' },
];

export default function Reports() {
  const { me, fetchMe } = useLibrary();
  const { fetchReport } = useReports();

  const [type, setType] = useState('stock-summary');
  const [campusId, setCampusId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState('50');
  const [months, setMonths] = useState('12');

  const [report, setReport] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => { fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library')); }, [fetchMe]);

  const isAdmin = !!me?.isAdmin;
  const defs = useMemo(() => REPORTS.filter((r) => !r.adminOnly || isAdmin), [isAdmin]);
  const def = REPORTS.find((r) => r.type === type) || REPORTS[0];

  const changeType = (t: string) => { setType(t); setReport(null); setError(''); setGroup(''); };

  const run = async () => {
    if (loading) return;
    if (from && to && from > to) { setError('The start date is after the end date'); return; }
    setLoading(true); setError('');
    try {
      const params: Record<string, string | number | undefined> = {
        campusId: isAdmin ? campusId || undefined : undefined,
        from: def.dates ? from || undefined : undefined,
        to: def.dates ? to || undefined : undefined,
      };
      if (def.extra === 'group-fines' || def.extra === 'group-borrowing') params.group = group || undefined;
      if (def.extra === 'status') params.status = status || undefined;
      if (def.extra === 'limit') params.limit = limit ? Number(limit) : undefined;
      if (def.extra === 'months') params.months = months ? Number(months) : undefined;
      setReport(await fetchReport(type, params));
    } catch (e: any) {
      setReport(null);
      setError(e.response?.data?.message || 'Could not run the report');
    } finally { setLoading(false); }
  };

  const fileName = (ext: string) => `library-${type}-${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}.${ext}`;
  const doExcel = () => { if (report) { try { exportReportExcel(report, fileName('xlsx')); } catch { toast.error('Excel export failed'); } } };
  const doPdf = async () => {
    if (!report || exporting) return;
    setExporting(true);
    try { await exportReportPDF(report, fileName('pdf')); } catch { toast.error('PDF export failed'); }
    finally { setExporting(false); }
  };

  const alignCls = (t: string) => (t === 'text' ? 'text-left' : t === 'date' ? 'text-center' : 'text-right');

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Library reports</h2>
        </div>

        <div className={`${card} space-y-3`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={labelCls} htmlFor="rp-type">Report</label>
              <select id="rp-type" value={type} onChange={(e) => changeType(e.target.value)} className={inputCls}>
                {defs.map((r) => <option key={r.type} value={r.type}>{r.label}</option>)}
              </select>
            </div>
            {isAdmin && me && (
              <div>
                <label className={labelCls} htmlFor="rp-campus">Campus</label>
                <select id="rp-campus" value={campusId} onChange={(e) => setCampusId(e.target.value)} className={inputCls}>
                  <option value="">All campuses</option>
                  {me.campuses.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {def.dates && (
              <>
                <div>
                  <label className={labelCls} htmlFor="rp-from">From</label>
                  <input id="rp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="rp-to">To</label>
                  <input id="rp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
                </div>
              </>
            )}
            {def.extra === 'group-fines' && (
              <div>
                <label className={labelCls} htmlFor="rp-group">Group by</label>
                <select id="rp-group" value={group} onChange={(e) => setGroup(e.target.value)} className={inputCls}>
                  <option value="">Day</option><option value="month">Month</option><option value="staff">Staff</option>
                </select>
              </div>
            )}
            {def.extra === 'group-borrowing' && (
              <div>
                <label className={labelCls} htmlFor="rp-group">Group by</label>
                <select id="rp-group" value={group} onChange={(e) => setGroup(e.target.value)} className={inputCls}>
                  <option value="">Student</option><option value="batch">Batch</option>
                </select>
              </div>
            )}
            {def.extra === 'status' && (
              <div>
                <label className={labelCls} htmlFor="rp-status">Status</label>
                <select id="rp-status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                  <option value="">Any</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
                </select>
              </div>
            )}
            {def.extra === 'limit' && (
              <div>
                <label className={labelCls} htmlFor="rp-limit">Top (max 200)</label>
                <input id="rp-limit" type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(e.target.value)} className={inputCls} />
              </div>
            )}
            {def.extra === 'months' && (
              <div>
                <label className={labelCls} htmlFor="rp-months">Not borrowed in the last (months)</label>
                <input id="rp-months" type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} className={inputCls} />
              </div>
            )}
          </div>
          {def.dates && <p className="text-xs text-gray-400 dark:text-gray-500">{def.dates}. Leave the dates empty to use the default.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={run} disabled={loading} className={primaryBtn}>{loading ? 'Running…' : 'Run report'}</button>
            {report && (
              <>
                <button type="button" onClick={doExcel} className={ghostBtn}>Excel</button>
                <button type="button" onClick={doPdf} disabled={exporting} className={ghostBtn}>{exporting ? 'Preparing…' : 'PDF'}</button>
              </>
            )}
          </div>
        </div>

        {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}
        {loading && <div className="h-40 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />}

        {report && !loading && (
          <div className={card}>
            <div className="mb-3">
              <p className="text-base font-semibold text-gray-800 dark:text-gray-100">{report.title}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {report.campus ? report.campus.name : 'All campuses'}
                {(report.from || report.to) && ` · ${report.from || 'start'} to ${report.to || 'today'}`}
                {` · ${report.rows.length} ${report.rows.length === 1 ? 'row' : 'rows'}`}
              </p>
              {report.truncated && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">Showing the first 5,000 rows only. Narrow the filters to see the rest.</p>}
            </div>
            {report.rows.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">No data for these filters.</p>
            ) : (
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-gray-800">
                    <tr className="text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                      {report.columns.map((c) => <th key={c.key} className={`py-2 px-2 font-medium whitespace-nowrap ${alignCls(c.type)}`}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, i) => (
                      <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50 text-gray-800 dark:text-gray-100">
                        {report.columns.map((c) => <td key={c.key} className={`py-1.5 px-2 ${alignCls(c.type)} ${c.type === 'text' ? '' : 'whitespace-nowrap'}`}>{fmtReportCell(c, row[c.key])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                  {report.totals && Object.keys(report.totals).length > 0 && (
                    <tfoot>
                      <tr className="font-bold border-t-2 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white">
                        {report.columns.map((c, i) => (
                          <td key={c.key} className={`py-2 px-2 ${alignCls(c.type)}`}>
                            {report.totals![c.key] !== undefined ? fmtReportCell(c, report.totals![c.key]) : i === 0 ? 'Total' : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
