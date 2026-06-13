import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { RootState } from '../store';
import { useBatches } from '../hooks/useBatches';
import { useStudents, Student } from '../hooks/useStudents';
import { useBatchTests, BulkEntry } from '../hooks/useTests';
import Layout from '../components/Layout';

const SUBJECTS = ['Physics', 'Chemistry', 'Math', 'Biology', 'Language 1', 'Language 2', 'Psychology', 'Computer Science'];
const inputCls = 'border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';

export default function BatchTestEntry() {
  const user = useSelector((s: RootState) => s.auth.user);
  const { batches, fetch: fetchBatches } = useBatches();
  const { students, fetchByBatch } = useStudents();
  const { submitting, bulkAdd } = useBatchTests();

  const [batchId, setBatchId]         = useState('');
  const [isWeekly, setIsWeekly]       = useState(true);
  const [testType, setTestType]       = useState('Theory');
  const [subject, setSubject]         = useState('Physics');
  const [maxMarks, setMaxMarks]       = useState('');
  const [chapter, setChapter]         = useState('');
  const [weekDate, setWeekDate]       = useState('');
  const [month, setMonth]             = useState('');
  const [year, setYear]               = useState(new Date().getFullYear().toString());
  const [entries, setEntries]         = useState<BulkEntry[]>([]);
  const [studentsLoaded, setStudentsLoaded] = useState(false);

  const visibleBatches = user?.role === 'ADMIN'
    ? batches
    : batches.filter(b => user?.batchIds?.includes(b.id));

  useEffect(() => { fetchBatches().catch(() => {}); }, [fetchBatches]);

  // Only clear entries when identity-changing fields change (batch, test type/subject, date/period).
  // maxMarks and chapter are metadata; changing them should not wipe already-entered marks.
  useEffect(() => {
    setEntries([]);
    setStudentsLoaded(false);
  }, [batchId, isWeekly, testType, subject, weekDate, month, year]);

  useEffect(() => {
    if (testType === 'MCQ') setChapter('');
  }, [testType]);

  async function handleLoadStudents() {
    if (!batchId) return;
    await fetchByBatch(batchId);
    setStudentsLoaded(true);
  }

  useEffect(() => {
    if (studentsLoaded) {
      setEntries(students.map(s => ({ studentId: s.id, marks: '' })));
    }
  }, [students, studentsLoaded]);

  function setMark(studentId: string, val: string) {
    setEntries(prev => prev.map(e => e.studentId === studentId ? { ...e, marks: val === '' ? '' : Number(val) } : e));
  }

  function fillAll(val: string) {
    setEntries(prev => prev.map(e => ({ ...e, marks: val === '' ? '' : Number(val) })));
  }

  function isFormValid() {
    if (!batchId || !subject || !maxMarks || Number(maxMarks) <= 0) return false;
    if (isWeekly && !weekDate) return false;
    if (!isWeekly && (!month || !year)) return false;
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validEntries = entries.filter(e => e.marks !== '' && Number(e.marks) >= 0);
    if (validEntries.length === 0) { toast.error('Enter at least one mark'); return; }

    try {
      const result = await bulkAdd(batchId, {
        isWeekly,
        testType,
        subject: testType === 'MCQ' ? 'General MCQ' : subject,
        maxMarks: Number(maxMarks),
        chapter: chapter || undefined,
        weekDate: isWeekly ? weekDate : undefined,
        month: !isWeekly ? Number(month) : undefined,
        year: Number(year),
        entries: validEntries.map(e => ({ studentId: e.studentId, marks: Number(e.marks) })),
      });
      toast.success(`${result.created} test(s) saved${result.skipped ? `, ${result.skipped} skipped (duplicate)` : ''}`);
      setEntries(prev => prev.map(e => ({ ...e, marks: '' })));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save tests');
    }
  }

  const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-5">
          <Link to="/" className="text-sm text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium">← Dashboard</Link>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mt-2">Batch Test Entry</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Enter marks for an entire batch at once</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Config card */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-4">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Test Configuration</p>

            {/* Batch */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Batch</label>
              <select value={batchId} onChange={e => setBatchId(e.target.value)} className={inputCls} required>
                <option value="">Select batch…</option>
                {visibleBatches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            {/* Weekly / Monthly toggle */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">Test Period</label>
              <div className="flex gap-3">
                {[{ label: 'Weekly', val: true }, { label: 'Monthly', val: false }].map(opt => (
                  <label key={opt.label} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                    <input type="radio" checked={isWeekly === opt.val} onChange={() => setIsWeekly(opt.val)} className="w-4 h-4 accent-indigo-600" />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Test type */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Test Type</label>
                <select value={testType} onChange={e => setTestType(e.target.value)} className={inputCls}>
                  <option value="Theory">Theory</option>
                  <option value="MCQ">MCQ</option>
                </select>
              </div>

              {/* Subject — hidden for MCQ */}
              {testType !== 'MCQ' && (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Subject</label>
                  <select value={subject} onChange={e => setSubject(e.target.value)} className={inputCls}>
                    {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {/* Date or Month+Year */}
              {isWeekly ? (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Date</label>
                  <input type="date" required value={weekDate} max={new Date().toISOString().split('T')[0]}
                    onChange={e => setWeekDate(e.target.value)} className={inputCls} />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Month (1–12)</label>
                    <input type="number" min="1" max="12" required value={month}
                      onChange={e => setMonth(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Year</label>
                    <input type="number" required value={year}
                      onChange={e => setYear(e.target.value)} className={inputCls} />
                  </div>
                </>
              )}

              {/* Max Marks */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Max Marks</label>
                <input type="number" required min="1" value={maxMarks}
                  onChange={e => setMaxMarks(e.target.value)} className={inputCls} placeholder="e.g. 100" />
              </div>

              {/* Chapter (theory only) */}
              {testType !== 'MCQ' && (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Chapter (optional)</label>
                  <input type="text" value={chapter} onChange={e => setChapter(e.target.value)}
                    className={inputCls} placeholder="e.g. Kinematics" />
                </div>
              )}
            </div>

            <button type="button" onClick={handleLoadStudents} disabled={!isFormValid()}
              className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50 transition-colors">
              Load Students
            </button>
          </div>

          {/* Marks entry table */}
          {studentsLoaded && entries.length > 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{entries.length} Students</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 dark:text-gray-500">Fill all:</span>
                  <input type="number" min="0" max={Number(maxMarks)} placeholder="marks"
                    onChange={e => fillAll(e.target.value)}
                    className="w-20 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-28">Reg No.</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Name</th>
                      <th className="text-right px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-36">Marks / {maxMarks || '?'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {entries.map(e => {
                      const s: Student | undefined = studentMap[e.studentId];
                      return (
                        <tr key={e.studentId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-400 dark:text-gray-500">{s?.regNumber}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-100">{s?.fullName}</td>
                          <td className="px-4 py-2.5 text-right">
                            <input
                              type="number" min="0" max={Number(maxMarks)}
                              value={e.marks}
                              onChange={ev => setMark(e.studentId, ev.target.value)}
                              placeholder="—"
                              className="w-24 text-right border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700">
                <button type="submit" disabled={submitting}
                  className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors">
                  {submitting ? 'Saving…' : `Save ${entries.filter(e => e.marks !== '').length} Results`}
                </button>
              </div>
            </div>
          )}

          {studentsLoaded && entries.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No active students in this batch.</p>
          )}
        </form>
      </div>
    </Layout>
  );
}
