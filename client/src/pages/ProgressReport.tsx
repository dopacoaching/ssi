import { Fragment, useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStudents, Student } from '../hooks/useStudents';
import { useCE, CERecord } from '../hooks/useCE';
import { useTests } from '../hooks/useTests';
import EmptyState from '../components/EmptyState';
import MonthMultiSelect from '../components/MonthMultiSelect';
const loadExportUtils = () => import('../utils/exportUtils');

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Language 2 is intentionally left out of this report (Progress Report only —
// it still appears in every other view/export) per explicit request.
const SUBJECTS: { label: string; mk: keyof CERecord; mx: keyof CERecord }[] = [
  { label: 'Physics',          mk: 'physicsMarks',         mx: 'physicsMax' },
  { label: 'Chemistry',        mk: 'chemMarks',            mx: 'chemMax' },
  { label: 'Math',             mk: 'mathMarks',            mx: 'mathMax' },
  { label: 'Biology',          mk: 'bioMarks',             mx: 'bioMax' },
  { label: 'Language 1',       mk: 'lang1Marks',           mx: 'lang1Max' },
  { label: 'Psychology',       mk: 'psychologyMarks',      mx: 'psychologyMax' },
  { label: 'Computer Science', mk: 'computerScienceMarks', mx: 'computerScienceMax' },
];

// "Weekly Exam" / "Grand Exam" are the combined, all-subjects MCQ sessions
// (weekly ones up to /360, the monthly one up to /720) — distinct from the
// per-subject Theory tests that make up the Theory Exam section below.
// Matched purely by testType === 'MCQ', same as the server's own CE
// aggregation (testController.js syncCEForMonth) — it pools every MCQ
// test's marks into the CE MCQ score regardless of subject text, so this
// report must use the same rule or it'll silently disagree with the CE score
// for a test entered under a specific subject instead of "General MCQ".
const isMCQ = (t: { testType: string }) => t.testType === 'MCQ';

const cardCls   = 'bg-white border border-gray-200 rounded-2xl overflow-hidden print:border-0 print:rounded-none';
const thCls     = 'px-3 py-2 text-xs font-bold text-white bg-slate-900 text-center';
const tdCls     = 'px-3 py-2 text-sm text-gray-700 text-center border-b border-gray-100';
const groupCls  = 'px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 text-left';
const subtotalCls = 'px-3 py-2 text-xs font-bold text-gray-700 bg-gray-50 text-center border-b border-gray-100';

function pctColor(pct: number) {
  return pct >= 75 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600';
}

export default function ProgressReport() {
  const { id } = useParams<{ id: string }>();
  const { fetchOne } = useStudents();
  const { records, loading: ceLoading, fetch: fetchCE } = useCE(id!);
  const { weekly, monthly, loading: testLoading, fetchAll } = useTests(id!);

  const [student, setStudent] = useState<Student | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchOne(id).then(setStudent);
    fetchCE();
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month)),
    [records]
  );

  const period = useMemo(() => {
    let base = sortedRecords;
    if (selectedYear) base = base.filter(r => String(r.year) === selectedYear);
    if (selectedMonths.length > 0) base = base.filter(r => selectedMonths.includes(r.month));
    return base;
  }, [sortedRecords, selectedMonths, selectedYear]);

  // ── Theory Exam Section ──
  // Subject columns with any data; each subject's header bracket shows the
  // max marks actually entered for the most recent month in view (monthly
  // totals vary, so we don't try to compute one dynamic overall total).
  const activeSubjects = useMemo(
    () => SUBJECTS.filter(s => period.some(r => (r[s.mx] as number) > 0)),
    [period]
  );
  const latestMaxBySubject = useMemo(() => {
    const map: Record<string, number> = {};
    activeSubjects.forEach(s => {
      for (let i = period.length - 1; i >= 0; i--) {
        const max = period[i][s.mx] as number;
        if (max > 0) { map[s.label] = max; break; }
      }
    });
    return map;
  }, [activeSubjects, period]);

  // ── Weekly Exams Section ── (4/month, /360 each — combined MCQ weekly tests)
  // Bucket MCQ weekly tests by month once, rather than re-scanning the full
  // array for every period row.
  const weeklyMCQByMonth = useMemo(() => {
    const map = new Map<string, typeof weekly>();
    weekly.filter(isMCQ).forEach(t => {
      const d = new Date(t.weekDate);
      const key = `${d.getMonth() + 1}-${d.getFullYear()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return map;
  }, [weekly]);

  const weeklyExamsByMonth = useMemo(() => period.map(r => {
    const exams = [...(weeklyMCQByMonth.get(`${r.month}-${r.year}`) ?? [])]
      .sort((a, b) => new Date(a.weekDate).getTime() - new Date(b.weekDate).getTime());
    const obtained = exams.reduce((a, t) => a + t.marks, 0);
    const total    = exams.reduce((a, t) => a + t.maxMarks, 0);
    return { month: r.month, year: r.year, exams, obtained, total, pct: total > 0 ? (obtained / total) * 100 : 0 };
  }), [period, weeklyMCQByMonth]);

  const weeklyOverall = useMemo(() => {
    const obtained = weeklyExamsByMonth.reduce((a, m) => a + m.obtained, 0);
    const total    = weeklyExamsByMonth.reduce((a, m) => a + m.total, 0);
    return { obtained, total, pct: total > 0 ? (obtained / total) * 100 : 0 };
  }, [weeklyExamsByMonth]);

  // ── Grand Exam Section ── (/720 per month — combined MCQ monthly test)
  const grandMCQByMonth = useMemo(() => {
    const map = new Map<string, typeof monthly>();
    monthly.filter(isMCQ).forEach(t => {
      const key = `${t.month}-${t.year}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return map;
  }, [monthly]);

  const grandExamsByMonth = useMemo(() => period.map(r => {
    const exams = grandMCQByMonth.get(`${r.month}-${r.year}`) ?? [];
    const obtained = exams.reduce((a, t) => a + t.marks, 0);
    const total    = exams.reduce((a, t) => a + t.maxMarks, 0);
    return { month: r.month, year: r.year, obtained, total, pct: total > 0 ? (obtained / total) * 100 : 0 };
  }), [period, grandMCQByMonth]);

  const grandOverall = useMemo(() => {
    const obtained = grandExamsByMonth.reduce((a, m) => a + m.obtained, 0);
    const total    = grandExamsByMonth.reduce((a, m) => a + m.total, 0);
    return { obtained, total, pct: total > 0 ? (obtained / total) * 100 : 0 };
  }, [grandExamsByMonth]);

  async function handleDownload() {
    if (!student) return;
    setDownloading(true);
    try {
      const { exportProgressReportPDF } = await loadExportUtils();
      exportProgressReportPDF({
        student: student as any,
        ceRecords: records as any,
        weekly: weekly as any,
        monthly: monthly as any,
        months: period.map(r => ({ month: r.month, year: r.year })),
      });
    } finally {
      setDownloading(false);
    }
  }

  const loading = ceLoading || testLoading;

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>

      {/* Toolbar (hidden on print) */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={id ? `/students/${id}` : '/students'} className="text-sm text-indigo-500 hover:text-indigo-700 font-medium">← Back to student</Link>
          <h2 className="text-lg font-bold text-gray-800 mt-1">Progress Report</h2>
        </div>
        <div className="flex items-center gap-2">
          <MonthMultiSelect
            selectedMonths={selectedMonths}
            onMonthsChange={setSelectedMonths}
            year={selectedYear}
            onYearChange={setSelectedYear}
            placeholder="All completed months"
          />
          <button
            onClick={() => window.print()}
            className="text-sm px-3 py-2 border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-50 font-medium"
          >
            🖨 Print
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading || period.length === 0}
            className="text-sm px-3 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium disabled:opacity-50"
          >
            {downloading ? 'Preparing…' : '↓ Download PDF'}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-6 print:p-0 print:max-w-none">
        {loading && <p className="text-sm text-gray-400 py-10 text-center">Loading…</p>}

        {!loading && !student && (
          <EmptyState title="Student not found" description="This student could not be loaded." icon="user" />
        )}

        {!loading && student && (
          <div className="space-y-6">
            {/* Header */}
            <div className={`${cardCls} p-5`}>
              <h1 className="text-2xl font-extrabold text-slate-900 text-center mb-4">Progress Report</h1>
              <div className="flex flex-wrap justify-center gap-x-10 gap-y-1 text-sm">
                <p><span className="text-gray-400 font-semibold">Student Name: </span><span className="font-bold text-gray-800">{student.fullName}</span></p>
                <p><span className="text-gray-400 font-semibold">Batch: </span><span className="font-bold text-gray-800">{student.batch?.name ?? '—'}</span></p>
              </div>
            </div>

            {period.length === 0 ? (
              <EmptyState title="No completed months" description="No CE records match the current filter — this student may not have any completed months yet." icon="document" />
            ) : (
              <>
                {/* Monthly CE Analysis */}
                <div className={cardCls}>
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight">Monthly CE (Continuous Evaluation) Analysis</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr>
                        <th className={`${thCls} text-left`}>Month</th>
                        <th className={thCls}>Theory Score (/10)</th>
                        <th className={thCls}>Notebook Score (/2)</th>
                        <th className={thCls}>MCQ Score (/5)</th>
                        <th className={thCls}>Attendance Score (/3)</th>
                        <th className={thCls}>Monthly CE Mark (/20)</th>
                      </tr></thead>
                      <tbody>
                        {period.map(r => (
                          <tr key={r.id}>
                            <td className={`${tdCls} text-left font-medium`}>{MONTHS[r.month]} {r.year}</td>
                            <td className={tdCls}>{r.theoryScore.toFixed(1)}</td>
                            <td className={tdCls}>{r.notesScore.toFixed(1)}</td>
                            <td className={tdCls}>{r.mcqScore.toFixed(1)}</td>
                            <td className={tdCls}>{r.attendScore.toFixed(1)}</td>
                            <td className={`${tdCls} font-bold text-indigo-700`}>{r.totalCE.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 1. Theory Exam Section */}
                <div className={cardCls}>
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight">Theory Exam Section</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">Subject totals shown are the marks each subject's exam was most recently conducted out of — monthly totals vary, so no single running total is calculated.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr>
                        <th className={`${thCls} text-left`}>Month</th>
                        {activeSubjects.map(s => (
                          <th key={s.label} className={thCls}>
                            {/* Math's max varies too widely month to month (unlike the other
                                subjects, which are consistently out of 30) for a single bracket
                                total to mean anything, so it's omitted here. */}
                            {s.label}{s.label !== 'Math' && ` (${latestMaxBySubject[s.label] ?? '—'})`}
                          </th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {period.map(r => (
                          <tr key={r.id}>
                            <td className={`${tdCls} text-left font-medium`}>{MONTHS[r.month]} {r.year}</td>
                            {activeSubjects.map(s => {
                              const marks = r[s.mk] as number, max = r[s.mx] as number;
                              return <td key={s.label} className={tdCls}>{max > 0 ? `${marks}/${max}` : '—'}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2. Weekly Exams Section */}
                <div className={cardCls}>
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight">Weekly Exams Section</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">Up to 4 weekly exams/month, 360 marks each (max possible 1,440/month)</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr>
                        <th className={`${thCls} text-left`}>Date</th>
                        <th className={thCls}>Obtained Marks</th>
                        <th className={thCls}>Total Marks</th>
                        <th className={thCls}>%</th>
                      </tr></thead>
                      <tbody>
                        {weeklyExamsByMonth.every(m => m.exams.length === 0) && (
                          <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">No weekly exam records for this period.</td></tr>
                        )}
                        {weeklyExamsByMonth.map(m => m.exams.length === 0 ? null : (
                          <Fragment key={`${m.month}-${m.year}`}>
                            <tr>
                              <td className={groupCls} colSpan={4}>{MONTHS[m.month]} {m.year}</td>
                            </tr>
                            {m.exams.map(e => (
                              <tr key={e.id}>
                                <td className={`${tdCls} text-left`}>{new Date(e.weekDate).toLocaleDateString()}</td>
                                <td className={tdCls}>{e.marks}</td>
                                <td className={tdCls}>{e.maxMarks}</td>
                                <td className={`${tdCls} ${pctColor(e.maxMarks > 0 ? (e.marks / e.maxMarks) * 100 : 0)}`}>
                                  {e.maxMarks > 0 ? `${((e.marks / e.maxMarks) * 100).toFixed(1)}%` : '—'}
                                </td>
                              </tr>
                            ))}
                            <tr>
                              <td className={`${subtotalCls} text-left`}>Monthly Total</td>
                              <td className={subtotalCls}>{m.obtained}</td>
                              <td className={subtotalCls}>{m.total}</td>
                              <td className={`${subtotalCls} ${pctColor(m.pct)}`}>{m.pct.toFixed(1)}%</td>
                            </tr>
                          </Fragment>
                        ))}
                      </tbody>
                      {weeklyOverall.total > 0 && (
                        <tfoot>
                          <tr className="bg-indigo-50">
                            <td className="px-3 py-2 text-xs font-bold text-indigo-700 text-left">Overall Percentage (Weekly Exams)</td>
                            <td className="px-3 py-2 text-xs font-bold text-indigo-700 text-center">{weeklyOverall.obtained}</td>
                            <td className="px-3 py-2 text-xs font-bold text-indigo-700 text-center">{weeklyOverall.total}</td>
                            <td className={`px-3 py-2 text-xs font-bold text-center ${pctColor(weeklyOverall.pct)}`}>{weeklyOverall.pct.toFixed(1)}%</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* 3. Grand Exam Section */}
                <div className={cardCls}>
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight">Grand Exam Section</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">1 grand/monthly exam, 720 marks each</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr>
                        <th className={`${thCls} text-left`}>Month</th>
                        <th className={thCls}>Obtained Marks</th>
                        <th className={thCls}>Total Marks</th>
                        <th className={thCls}>%</th>
                      </tr></thead>
                      <tbody>
                        {grandExamsByMonth.every(m => m.total === 0) && (
                          <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">No grand exam records for this period.</td></tr>
                        )}
                        {grandExamsByMonth.filter(m => m.total > 0).map(m => (
                          <tr key={`${m.month}-${m.year}`}>
                            <td className={`${tdCls} text-left font-medium`}>{MONTHS[m.month]} {m.year}</td>
                            <td className={tdCls}>{m.obtained}</td>
                            <td className={tdCls}>{m.total}</td>
                            <td className={`${tdCls} font-bold ${pctColor(m.pct)}`}>{m.pct.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                      {grandOverall.total > 0 && (
                        <tfoot>
                          <tr className="bg-indigo-50">
                            <td className="px-3 py-2 text-xs font-bold text-indigo-700 text-left">Accumulated Total (Grand Exam Performance)</td>
                            <td className="px-3 py-2 text-xs font-bold text-indigo-700 text-center">{grandOverall.obtained}</td>
                            <td className="px-3 py-2 text-xs font-bold text-indigo-700 text-center">{grandOverall.total}</td>
                            <td className={`px-3 py-2 text-xs font-bold text-center ${pctColor(grandOverall.pct)}`}>{grandOverall.pct.toFixed(1)}%</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* 4. Verification — Class Teacher left, Parent right, Principal centred and lower */}
                <div className={cardCls}>
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight">Verification &amp; Approval</h3>
                  </div>
                  <div className="px-6 pt-14 pb-8">
                    <div className="flex justify-between gap-x-12">
                      {['Class Teacher', 'Parent / Guardian'].map(role => (
                        <div key={role} className="w-52 max-w-[45%]">
                          <div className="border-t border-slate-400" />
                          <p className="text-xs font-semibold text-slate-700 mt-2">{role}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">Signature &amp; Date</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-center mt-16">
                      <div className="w-52 text-center">
                        <div className="border-t border-slate-400" />
                        <p className="text-xs font-semibold text-slate-700 mt-2">Principal</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">Signature &amp; Date</p>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
