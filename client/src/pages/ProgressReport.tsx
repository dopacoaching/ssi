import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStudents, Student } from '../hooks/useStudents';
import { useCE, CERecord } from '../hooks/useCE';
import { useTests } from '../hooks/useTests';
import EmptyState from '../components/EmptyState';
import MonthMultiSelect from '../components/MonthMultiSelect';
const loadExportUtils = () => import('../utils/exportUtils');

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SUBJECTS: { label: string; mk: keyof CERecord; mx: keyof CERecord }[] = [
  { label: 'Physics',          mk: 'physicsMarks',         mx: 'physicsMax' },
  { label: 'Chemistry',        mk: 'chemMarks',            mx: 'chemMax' },
  { label: 'Math',             mk: 'mathMarks',            mx: 'mathMax' },
  { label: 'Biology',          mk: 'bioMarks',             mx: 'bioMax' },
  { label: 'Language 1',       mk: 'lang1Marks',           mx: 'lang1Max' },
  { label: 'Language 2',       mk: 'lang2Marks',           mx: 'lang2Max' },
  { label: 'Psychology',       mk: 'psychologyMarks',      mx: 'psychologyMax' },
  { label: 'Computer Science', mk: 'computerScienceMarks', mx: 'computerScienceMax' },
];

const cardCls = 'bg-white border border-gray-200 rounded-2xl overflow-hidden print:border-0 print:rounded-none';
const thCls   = 'px-3 py-2 text-xs font-bold text-white bg-slate-900 text-center';
const tdCls   = 'px-3 py-2 text-sm text-gray-700 text-center border-b border-gray-100';

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

  const activeSubjects = useMemo(
    () => SUBJECTS.filter(s => period.some(r => (r[s.mx] as number) > 0)),
    [period]
  );

  const { totalObtained, totalMax } = useMemo(() => {
    let obtained = 0, max = 0;
    period.forEach(r => activeSubjects.forEach(s => { obtained += r[s.mk] as number; max += r[s.mx] as number; }));
    return { totalObtained: obtained, totalMax: max };
  }, [period, activeSubjects]);
  const overallPct = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0;

  const consolidation = useMemo(() => period.map(r => {
    const wTests = weekly.filter(t => {
      if (t.testType !== 'Theory') return false;
      const d = new Date(t.weekDate);
      return d.getMonth() + 1 === r.month && d.getFullYear() === r.year;
    });
    const mTests = monthly.filter(t => t.testType === 'Theory' && t.month === r.month && t.year === r.year);
    const wMarks = wTests.reduce((a, t) => a + t.marks, 0), wMax = wTests.reduce((a, t) => a + t.maxMarks, 0);
    const gMarks = mTests.reduce((a, t) => a + t.marks, 0), gMax = mTests.reduce((a, t) => a + t.maxMarks, 0);
    const tMarks = wMarks + gMarks, tMax = wMax + gMax;
    return { month: r.month, year: r.year, wMarks, wMax, gMarks, gMax, tMarks, tMax, pct: tMax > 0 ? (tMarks / tMax) * 100 : 0 };
  }), [period, weekly, monthly]);

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
                {/* Section 1: Monthly CE Analysis */}
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

                {/* Section 2 + 3 side by side */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:grid-cols-1">
                  {/* Section 2: Subject-wise Performance */}
                  <div className={cardCls}>
                    <div className="px-4 py-3 border-b border-gray-100">
                      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight">Subject-wise Performance</h3>
                      <p className="text-[11px] text-gray-400 mt-0.5">4 weekly exams (15 each) + 1 monthly exam (30) = /90 per subject</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead><tr>
                          <th className={`${thCls} text-left`}>Month</th>
                          {activeSubjects.map(s => <th key={s.label} className={thCls}>{s.label}</th>)}
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
                        <tfoot>
                          <tr className="bg-indigo-50">
                            <td className="px-3 py-2 text-xs font-bold text-indigo-700 text-left" colSpan={activeSubjects.length}>
                              Total Obtained Marks: {totalObtained.toFixed(1)} / {totalMax.toFixed(1)}
                            </td>
                            <td className="px-3 py-2 text-xs font-bold text-indigo-700 text-center whitespace-nowrap">
                              {overallPct.toFixed(1)}%
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Section 3: Weekly vs Grand Exam Consolidation */}
                  <div className={cardCls}>
                    <div className="px-4 py-3 border-b border-gray-100">
                      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight">Exam Consolidation</h3>
                      <p className="text-[11px] text-gray-400 mt-0.5">Weekly exams vs. grand/monthly exam, all subjects combined</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead><tr>
                          <th className={`${thCls} text-left`}>Month</th>
                          <th className={thCls}>Weekly Exam Mark</th>
                          <th className={thCls}>Grand Exam Mark</th>
                          <th className={thCls}>Total Obtained Mark</th>
                          <th className={thCls}>Percentage (%)</th>
                        </tr></thead>
                        <tbody>
                          {consolidation.map(c => (
                            <tr key={`${c.month}-${c.year}`}>
                              <td className={`${tdCls} text-left font-medium`}>{MONTHS[c.month]} {c.year}</td>
                              <td className={tdCls}>{c.wMax > 0 ? `${c.wMarks}/${c.wMax}` : '—'}</td>
                              <td className={tdCls}>{c.gMax > 0 ? `${c.gMarks}/${c.gMax}` : '—'}</td>
                              <td className={`${tdCls} font-bold`}>{c.tMax > 0 ? `${c.tMarks}/${c.tMax}` : '—'}</td>
                              <td className={`${tdCls} font-bold ${c.pct >= 75 ? 'text-emerald-600' : c.pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                {c.tMax > 0 ? `${c.pct.toFixed(1)}%` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Section 4: Sign-off */}
                <div className={`${cardCls} p-6`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-10">
                    {['Signature of Parent', 'Signature of Teacher', 'Signature of Class Teacher', 'Signature of Principal'].map(label => (
                      <div key={label}>
                        <div className="border-b border-gray-400 h-8" />
                        <p className="text-xs text-gray-500 mt-1.5">{label}</p>
                      </div>
                    ))}
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
