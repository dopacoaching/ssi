import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { RootState } from '../store';
import { useBatches } from '../hooks/useBatches';
import { useAdmin, AlertStudent } from '../hooks/useAdmin';
import Layout from '../components/Layout';

export default function Dashboard() {
  const user = useSelector((s: RootState) => s.auth.user);
  const { batches, loading, fetch } = useBatches();
  const { teachers, fetchTeachers, fetchAlerts } = useAdmin();
  const [alerts, setAlerts] = useState<AlertStudent[]>([]);

  useEffect(() => {
    fetch().catch(() => toast.error('Failed to load batches'));
    if (user?.role === 'ADMIN') fetchTeachers().catch(() => {});
    if (user?.role === 'ADMIN' || user?.role === 'TEACHER') {
      fetchAlerts().then(setAlerts).catch(() => {});
    }
  }, [fetch, fetchTeachers, fetchAlerts, user?.role]);

  if (user && (user.role as string) === 'STUDENT') {
    return <Navigate to={`/students/${user.id}`} replace />;
  }

  function teachersForBatch(batchId: string) {
    return teachers.filter((t) => t.batchIds.includes(batchId)).map((t) => t.name);
  }

  const visible = user?.role === 'ADMIN'
    ? batches
    : batches.filter((b) => user?.batchIds?.includes(b.id));

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Dashboard</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Welcome back, {user?.name}</p>
        </div>

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-36 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((batch) => {
            const tNames = teachersForBatch(batch.id);
            return (
              <Link
                key={batch.id}
                to={`/students?batch=${batch.id}`}
                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-md transition-all active:scale-[0.98]"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-gray-100 text-base">{batch.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Year {batch.year}</p>
                  </div>
                  <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                    {batch._count?.students ?? 0}
                  </span>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">students</p>
                {user?.role === 'ADMIN' && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tNames.length === 0
                      ? <span className="text-xs text-gray-300 dark:text-gray-600">No teacher assigned</span>
                      : tNames.map((name) => (
                          <span key={name} className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full font-medium">
                            {name}
                          </span>
                        ))
                    }
                  </div>
                )}
              </Link>
            );
          })}

          {!loading && visible.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500 col-span-3">No batches assigned yet.</p>
          )}
        </div>

        {alerts.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">Needs Attention</h3>
              <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full font-semibold">{alerts.length}</span>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
              {alerts.map(s => {
                const trend = s.prevCE ? s.latestCE.totalCE - s.prevCE.totalCE : null;
                return (
                  <Link key={s.id} to={`/students/${s.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 group">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{s.fullName}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{s.regNumber} &middot; {s.batch.name}</p>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <p className={`text-xs font-semibold ${s.latestCE.totalCE < 10 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          CE {s.latestCE.totalCE.toFixed(1)}/20
                        </p>
                        {s.latestCE.attendancePct < 90 && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">{s.latestCE.attendancePct.toFixed(0)}% att.</p>
                        )}
                      </div>
                      {trend !== null && (
                        <span className={`text-sm font-bold ${trend > 0 ? 'text-emerald-500' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                          {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
