import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { useStudents, Student } from '../hooks/useStudents';
import { useCE } from '../hooks/useCE';
import { useTests, WeeklyTest, MonthlyTest } from '../hooks/useTests';
import { useRemarks } from '../hooks/useRemarks';
import { useAuth } from '../hooks/useAuth';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Tab = 'overview' | 'results' | 'feedback';

export default function StudentPortal() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const user = useSelector((s: RootState) => s.auth.user);
  
  const { fetchOne } = useStudents();
  const { records, fetch: fetchCE } = useCE(id!);
  const { weekly, monthly, loading: testLoading, fetchAll } = useTests(id!);
  const { remarks, loading: remarkLoading, fetch: fetchRemarks } = useRemarks(id!);

  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      fetchOne(id).then(s => setStudent(s)),
      fetchCE().catch(() => {}),
      fetchAll(),
      fetchRemarks()
    ]).finally(() => setLoading(false));
  }, [id, fetchOne, fetchCE, fetchAll, fetchRemarks]);

  if (loading) {
    return <div className="min-h-screen bg-white flex items-center justify-center text-emerald-600 font-bold">Loading...</div>;
  }

  if (!student) {
    return <div className="p-12 text-center text-slate-400">Profile not found.</div>;
  }

  const formatType = (type: string) => type === 'Theory' ? 'Theory' : 'MCQ';

  const getPerformanceStatus = (marks: number, max: number) => {
    const pct = (marks / max) * 100;
    if (pct >= 80) return { label: 'Excellent', color: 'text-emerald-600' };
    if (pct >= 60) return { label: 'Good', color: 'text-blue-600' };
    if (pct >= 40) return { label: 'Satisfactory', color: 'text-amber-600' };
    return { label: 'Needs Improvement', color: 'text-rose-600' };
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-24">
      {/* Ultra Simple Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
             <img src="/dopa-logo.png" alt="DOPA Logo" className="h-8 w-auto" />
             <h1 className="text-lg font-bold tracking-tight">Student Portal</h1>
          </div>
          <button 
            onClick={() => { logout(); navigate('/student/login'); }}
            className="text-xs font-bold text-slate-400 hover:text-slate-900 transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Simple Profile Overview */}
        <div className="mb-10 flex items-center gap-5">
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-slate-200 bg-emerald-100 flex items-center justify-center flex-shrink-0">
            {student.photo
              ? <img src={student.photo} alt={student.fullName} className="w-full h-full object-cover" />
              : <span className="text-3xl font-bold text-emerald-600 select-none">{student.fullName.charAt(0).toUpperCase()}</span>
            }
          </div>
          <div>
            <h2 className="text-3xl font-bold text-slate-800">{student.fullName}</h2>
            <p className="text-sm text-slate-500 mt-1">Registration: {student.regNumber} &bull; Batch: {student.batch?.name}</p>
          </div>
        </div>

        {/* Clean Tabs */}
        <div className="flex gap-8 border-b border-slate-200 mb-10 overflow-x-auto pb-px">
          {(['overview', 'results', 'feedback'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-4 text-xs font-bold uppercase tracking-widest transition-all relative ${
                tab === t 
                  ? 'text-emerald-600' 
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {t === 'overview' ? 'Profile' : t === 'results' ? 'Exam Results' : 'Teacher Notes'}
              {tab === t && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-emerald-600"></div>}
            </button>
          ))}
        </div>

        {/* Sections */}
        <div className="space-y-6">
          
          {tab === 'overview' && (
            <div className="space-y-6">
              {/* Personal Info */}
              <div className="bg-white p-8 rounded-2xl border border-slate-200">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Personal Details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {[
                    { label: 'Registration', value: student.regNumber },
                    { label: 'Batch', value: student.batch?.name },
                  ].map(item => (
                    <div key={item.label}>
                      <p className="text-[10px] font-bold text-slate-300 uppercase mb-1">{item.label}</p>
                      <p className="text-sm font-medium text-slate-700">{item.value || '---'}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Attendance & Notes */}
              {records.length > 0 && (
                <div className="bg-white p-8 rounded-2xl border border-slate-200">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Class Attendance</h3>
                  {records.slice(0, 1).map(r => (
                    <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                      <div className="flex-1">
                        <div className="flex justify-between items-end mb-2">
                           <p className="text-sm font-bold text-slate-700">{MONTHS[r.month]} Attendance</p>
                           <p className="text-xl font-bold text-emerald-600">{r.attendancePct}%</p>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                           <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${r.attendancePct}%` }} />
                        </div>
                      </div>
                      <div className="sm:w-px sm:h-12 bg-slate-100 hidden sm:block"></div>
                      <div className="flex items-center gap-4">
                        <p className="text-xs font-bold text-slate-400 uppercase">Notes Status</p>
                        <span className="text-sm font-bold text-slate-700">{r.notesStatus}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Recent Results */}
              <div className="bg-white p-8 rounded-2xl border border-slate-200">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Recent Performance</h3>
                <div className="divide-y divide-slate-100">
                  {weekly.slice(0, 4).map(test => {
                    const status = getPerformanceStatus(test.marks, test.maxMarks);
                    return (
                      <div key={test.id} className="py-4 flex justify-between items-center">
                        <div>
                          <p className="text-sm font-bold text-slate-700">{test.subject}</p>
                          <p className="text-[10px] text-slate-400 font-medium uppercase">{formatType(test.testType)} &bull; {new Date(test.weekDate).toLocaleDateString()}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-slate-900">{test.marks} / {test.maxMarks}</p>
                          <p className={`text-[10px] font-bold ${status.color}`}>{status.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === 'results' && (
            <div className="space-y-12">
               {/* Simplified Test List */}
               <section>
                 <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Theory Exam History</h3>
                 <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                   {weekly.filter(t => t.testType === 'Theory').map(test => (
                     <div key={test.id} className="p-6 border-b border-slate-50 last:border-0 flex justify-between items-center hover:bg-slate-50 transition-colors">
                        <div>
                          <p className="text-sm font-bold text-slate-700">{test.subject}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase">{new Date(test.weekDate).toLocaleDateString()} {test.chapter && `\u2022 ${test.chapter}`}</p>
                        </div>
                        <p className="text-sm font-bold text-emerald-600">{test.marks} / {test.maxMarks}</p>
                     </div>
                   ))}
                   {weekly.filter(t => t.testType === 'Theory').length === 0 && <p className="p-8 text-center text-sm text-slate-400">No theory results recorded.</p>}
                 </div>
               </section>

               <section>
                 <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">MCQ Exam History</h3>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   {weekly.filter(t => t.testType === 'MCQ').map(test => (
                     <div key={test.id} className="bg-white p-6 rounded-2xl border border-slate-200">
                        <div className="flex justify-between items-start mb-2">
                           <p className="text-sm font-bold text-slate-700">{test.subject}</p>
                           <p className="text-[10px] text-slate-400 font-bold">{new Date(test.weekDate).toLocaleDateString()}</p>
                        </div>
                        <p className="text-xl font-bold text-slate-900">{test.marks} / {test.maxMarks}</p>
                     </div>
                   ))}
                   {weekly.filter(t => t.testType === 'MCQ').length === 0 && <p className="col-span-full py-10 text-center text-sm text-slate-400 bg-white rounded-2xl border border-slate-200">No MCQ results recorded.</p>}
                 </div>
               </section>
               <section>
                 <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Monthly Exam History</h3>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   {monthly.map(test => (
                     <div key={test.id} className="bg-white p-6 rounded-2xl border border-slate-200">
                        <div className="flex justify-between items-center mb-2">
                           <p className="text-sm font-bold text-slate-700">{test.subject}</p>
                           <p className="text-[10px] text-slate-400 font-bold">{MONTHS[test.month]} {test.year}</p>
                        </div>
                        <p className="text-[10px] text-emerald-600 font-bold uppercase mb-4">{test.testType}</p>
                        <p className="text-xl font-bold text-slate-900">{test.marks} / {test.maxMarks}</p>
                     </div>
                   ))}
                   {monthly.length === 0 && <p className="col-span-full py-10 text-center text-sm text-slate-400 bg-white rounded-2xl border border-slate-200">No monthly exams recorded.</p>}
                 </div>
               </section>
            </div>
          )}

          {tab === 'feedback' && (
            <div className="space-y-4">
              {remarks.map(r => (
                <div key={r.id} className={`p-8 rounded-2xl border ${r.isFlagged ? 'bg-rose-50 border-rose-100' : 'bg-white border-slate-200'}`}>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">{r.category}</span>
                    <span className="text-[10px] text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-base text-slate-700 leading-relaxed italic">"{r.text}"</p>
                </div>
              ))}
              {remarks.length === 0 && <div className="p-12 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">No feedback available.</div>}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
