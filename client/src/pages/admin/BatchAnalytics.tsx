import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { useBatches } from '../../hooks/useBatches';
import { useAdmin, BatchAnalytics as AnalyticsData } from '../../hooks/useAdmin';
import Layout from '../../components/Layout';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SUBJECT_LABELS: Record<string, string> = { physics: 'Physics', chem: 'Chemistry', math: 'Math', bio: 'Biology', lang1: 'Lang 1', lang2: 'Lang 2', psychology: 'Psychology', computerScience: 'Computer Sci' };

export default function BatchAnalytics() {
  const user = useSelector((s: RootState) => s.auth.user);
  const { batches, fetch: fetchBatches } = useBatches();
  const { fetchAnalytics } = useAdmin();

  const [batchId, setBatchId]   = useState('');
  const [data, setData]         = useState<AnalyticsData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const visibleBatches = user?.role === 'ADMIN'
    ? batches
    : batches.filter(b => user?.batchIds?.includes(b.id));

  useEffect(() => { fetchBatches().catch(() => {}); }, [fetchBatches]);

  useEffect(() => {
    if (!batchId) { setData(null); return; }
    setLoading(true); setError('');
    fetchAnalytics(batchId)
      .then(setData)
      .catch(() => setError('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [batchId, fetchAnalytics]);

  const ceChartData = useMemo(() => data?.ceMonthly.map(m => ({
    name: `${MONTHS[m.month]} ${m.year}`,
    avgCE: Number(m.avgCE.toFixed(1)),
    avgAtt: Number(m.avgAttendance.toFixed(1)),
  })) ?? [], [data]);

  const subjectChartData = useMemo(() => data
    ? Object.entries(data.subjectAverages)
        .map(([k, v]) => ({ subject: SUBJECT_LABELS[k] ?? k, pct: Number(v.toFixed(1)) }))
        .filter(d => d.pct > 0)
    : [], [data]);

  const chartProps = {
    tickStyle: { fill: 'currentColor', fontSize: 11 },
    gridStyle: 'rgba(128,128,128,0.15)' as const,
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-5">
          <Link to="/" className="text-sm text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium">← Dashboard</Link>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mt-2">Batch Analytics</h2>
        </div>

        {/* Batch selector */}
        <div className="mb-6">
          <div className="flex gap-2 flex-wrap">
            {visibleBatches.map(b => (
              <button key={b.id} onClick={() => setBatchId(b.id)}
                className={`text-sm px-4 py-2 rounded-xl font-medium transition-colors ${batchId === b.id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-500'}`}>
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {!batchId && <p className="text-sm text-gray-400 dark:text-gray-500">Select a batch to view analytics.</p>}
        {loading && <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p>}
        {error   && <p className="text-sm text-red-500">{error}</p>}

        {data && !loading && (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Students', value: data.studentCount, color: 'text-indigo-600 dark:text-indigo-400' },
                { label: 'Months on record', value: data.ceMonthly.length, color: 'text-gray-700 dark:text-gray-200' },
                { label: 'Avg CE (latest)', value: data.ceMonthly.length > 0 ? data.ceMonthly[data.ceMonthly.length - 1].avgCE.toFixed(1) : '—', color: 'text-emerald-600 dark:text-emerald-400' },
                { label: 'At Risk', value: data.atRisk.length, color: data.atRisk.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500' },
              ].map(c => (
                <div key={c.label} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4">
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider mb-1">{c.label}</p>
                  <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>

            {/* CE trend line chart */}
            {ceChartData.length > 0 && (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-4">Average CE Over Time</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={ceChartData} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartProps.gridStyle} />
                    <XAxis dataKey="name" tick={chartProps.tickStyle} />
                    <YAxis domain={[0, 20]} tick={chartProps.tickStyle} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={10} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.5} />
                    <Line type="monotone" dataKey="avgCE" stroke="#6366f1" strokeWidth={2} dot={{ r: 4, fill: '#6366f1' }} name="Avg CE (/20)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Subject averages bar chart */}
            {subjectChartData.length > 0 && (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-4">Subject-wise Class Average</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={subjectChartData} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartProps.gridStyle} />
                    <XAxis dataKey="subject" tick={chartProps.tickStyle} />
                    <YAxis domain={[0, 100]} tick={chartProps.tickStyle} unit="%" />
                    <Tooltip formatter={(v) => typeof v === 'number' ? `${v.toFixed(1)}%` : v} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="pct" fill="#818cf8" radius={[4, 4, 0, 0]} name="Avg %" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Top performers */}
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3">Top Performers</h3>
                {data.topStudents.length === 0
                  ? <p className="text-sm text-gray-400">No data yet</p>
                  : (
                    <div className="space-y-2">
                      {data.topStudents.map((s, i) => (
                        <Link key={s.id} to={`/students/${s.id}`} className="flex items-center justify-between group">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold w-5 ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-gray-300 dark:text-gray-600'}`}>#{i + 1}</span>
                            <div>
                              <p className="text-sm font-medium text-gray-800 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{s.fullName}</p>
                              <p className="text-xs text-gray-400 font-mono">{s.regNumber}</p>
                            </div>
                          </div>
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{s.avgCE.toFixed(1)}</span>
                        </Link>
                      ))}
                    </div>
                  )
                }
              </div>

              {/* At risk */}
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3">Needs Attention</h3>
                {data.atRisk.length === 0
                  ? <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">All students on track</p>
                  : (
                    <div className="space-y-2">
                      {data.atRisk.map(s => (
                        <Link key={s.id} to={`/students/${s.id}`} className="flex items-center justify-between group">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{s.fullName}</p>
                            <p className="text-xs text-gray-400 font-mono">{s.regNumber}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-semibold text-red-600 dark:text-red-400">CE {s.avgCE.toFixed(1)}</p>
                            {s.avgAttendance < 90 && <p className="text-xs text-amber-600 dark:text-amber-400">{s.avgAttendance.toFixed(0)}% att.</p>}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )
                }
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
