import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { RootState } from '../store';
import { useBatches } from '../hooks/useBatches';
import { useStudents, Student } from '../hooks/useStudents';
import { useAdmin } from '../hooks/useAdmin';
import Layout from '../components/Layout';
import EmptyState from '../components/EmptyState';
import api from '../utils/api';
import { exportBatchExcel, exportBatchPDF, BatchReportStudent, exportStudentsExcel, exportStudentsPDF } from '../utils/exportUtils';
import { resizeImage } from '../utils/resizeImage';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inputCls = 'border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';

export default function Students() {
  const user = useSelector((s: RootState) => s.auth.user);
  const [params, setParams] = useSearchParams();
  const selectedBatch = params.get('batch') || '';

  const { batches, fetch: fetchBatches } = useBatches();
  const { students, loading, fetchByBatch, create, fetchBatchReport } = useStudents();
  const { teachers, fetchTeachers } = useAdmin();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: '', regNumber: '', password: '' });
  const [photoPreview, setPhotoPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMonth, setExportMonth] = useState<string>('');
  const [exportYear, setExportYear] = useState<number>(new Date().getFullYear());
  const [sortBy, setSortBy] = useState<string>('default');

  const [batchApprovals, setBatchApprovals] = useState<{ month: number; year: number }[]>([]);
  const [lockForm, setLockForm] = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear() });
  const [locking, setLocking] = useState(false);

  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [transferTargetBatch, setTransferTargetBatch] = useState<string>('');
  const [transferring, setTransferring] = useState<boolean>(false);

  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudents((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const toggleAllStudents = () => {
    if (selectedStudents.length === students.length) {
      setSelectedStudents([]);
    } else {
      setSelectedStudents(students.map((s) => s.id));
    }
  };

  async function handleTransferSubmit() {
    if (selectedStudents.length === 0) return;
    if (!transferTargetBatch) {
      toast.error('Please select a target batch');
      return;
    }
    const targetName = batches.find((b) => b.id === transferTargetBatch)?.name ?? 'selected batch';
    if (!window.confirm(`Are you sure you want to transfer ${selectedStudents.length} students to ${targetName}?`)) return;

    setTransferring(true);
    try {
      await api.post('/admin/batches/transfer', {
        studentIds: selectedStudents,
        targetBatchId: transferTargetBatch,
      });
      toast.success(`${selectedStudents.length} students transferred successfully!`);
      setSelectedStudents([]);
      setTransferTargetBatch('');
      if (selectedBatch) {
        fetchByBatch(selectedBatch).catch(() => {});
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to transfer students');
    } finally {
      setTransferring(false);
    }
  }

  const fetchApprovals = useCallback(async (batchId: string) => {
    try {
      const res = await api.get(`/admin/batches/${batchId}/approvals`);
      setBatchApprovals(res.data.data || []);
    } catch {
      toast.error('Failed to load batch approvals');
    }
  }, []);

  async function handleLockToggle(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBatch) return;
    setLocking(true);
    try {
      await api.post(`/admin/batches/${selectedBatch}/approvals`, {
        month: lockForm.month,
        year: lockForm.year,
        isApproved: true,
      });
      toast.success('Batch month approved and locked successfully!');
      fetchApprovals(selectedBatch);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to lock batch month');
    } finally {
      setLocking(false);
    }
  }

  async function handleUnlock(month: number, year: number) {
    if (!selectedBatch) return;
    if (!window.confirm(`Are you sure you want to unlock ${MONTHS[month]} ${year} for this batch?`)) return;
    try {
      await api.post(`/admin/batches/${selectedBatch}/approvals`, {
        month,
        year,
        isApproved: false,
      });
      toast.success('Batch month unlocked successfully!');
      fetchApprovals(selectedBatch);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to unlock batch month');
    }
  }

  useEffect(() => { fetchBatches().catch(() => {}); }, [fetchBatches]);
  useEffect(() => { if (user?.role === 'ADMIN') fetchTeachers().catch(() => {}); }, [fetchTeachers, user?.role]);
  useEffect(() => { if (selectedBatch) fetchByBatch(selectedBatch).catch(() => {}); }, [selectedBatch, fetchByBatch]);
  useEffect(() => { if (selectedBatch) fetchApprovals(selectedBatch).catch(() => {}); }, [selectedBatch, fetchApprovals]);
  useEffect(() => { setSelectedStudents([]); }, [selectedBatch]);

  function teachersForBatch(batchId: string) {
    return teachers.filter((t) => t.batchIds.includes(batchId)).map((t) => t.name);
  }

  const sortedStudents = useMemo(() => [...students].sort((a, b) => {
    if (sortBy === 'name') {
      return a.fullName.localeCompare(b.fullName);
    }
    if (sortBy === 'reg') {
      return a.regNumber.localeCompare(b.regNumber, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (sortBy === 'performanceAll') {
      const aRecs = a.ceRecords ?? [];
      const bRecs = b.ceRecords ?? [];
      if (aRecs.length === 0 && bRecs.length === 0) return 0;
      if (aRecs.length === 0) return 1;
      if (bRecs.length === 0) return -1;
      const aAvg = aRecs.reduce((sum, r) => sum + r.totalCE, 0) / aRecs.length;
      const bAvg = bRecs.reduce((sum, r) => sum + r.totalCE, 0) / bRecs.length;
      return bAvg - aAvg;
    }
    if (sortBy === 'performanceMonth') {
      const mNum = exportMonth !== '' ? Number(exportMonth) : new Date().getMonth() + 1;
      const yNum = exportMonth !== '' ? exportYear : new Date().getFullYear();
      const aRec = (a.ceRecords ?? []).find(r => r.month === mNum && r.year === yNum);
      const bRec = (b.ceRecords ?? []).find(r => r.month === mNum && r.year === yNum);
      return (bRec ? bRec.totalCE : -1) - (aRec ? aRec.totalCE : -1);
    }
    return 0;
  }), [students, sortBy, exportMonth, exportYear]);

  const visible = user?.role === 'ADMIN'
    ? batches
    : batches.filter((b) => user?.batchIds?.includes(b.id));

  async function handleExportAllMarks(type: 'excel' | 'pdf') {
    if (!selectedBatch) return;
    setExporting(true);
    try {
      const allStudents: BatchReportStudent[] = await fetchBatchReport(selectedBatch);
      const batchName = batches.find((b) => b.id === selectedBatch)?.name ?? 'batch';
      
      let finalStudents = allStudents;
      let suffix = '';
      
      if (exportMonth !== '') {
        const mNum = Number(exportMonth);
        suffix = `_${MONTHS[mNum]}_${exportYear}`;
        
        finalStudents = allStudents.map((student) => {
          const filteredWeekly = student.weeklyTests.filter((t) => {
            const d = new Date(t.weekDate);
            return d.getMonth() + 1 === mNum && d.getFullYear() === exportYear;
          });
          const filteredMonthly = student.monthlyTests.filter((t) => {
            return t.month === mNum && t.year === exportYear;
          });
          const filteredCE = student.ceRecords.filter((r) => {
            return r.month === mNum && r.year === exportYear;
          });
          return {
            ...student,
            weeklyTests: filteredWeekly,
            monthlyTests: filteredMonthly,
            ceRecords: filteredCE,
          };
        });
      }
      
      // Apply active sorting (sortBy) to the exported data
      if (sortBy !== 'default') {
        finalStudents = [...finalStudents].sort((a, b) => {
          if (sortBy === 'name') {
            return a.fullName.localeCompare(b.fullName);
          }
          if (sortBy === 'reg') {
            return a.regNumber.localeCompare(b.regNumber, undefined, { numeric: true, sensitivity: 'base' });
          }
          if (sortBy === 'performanceAll') {
            const aRecs = a.ceRecords ?? [];
            const bRecs = b.ceRecords ?? [];
            if (aRecs.length === 0 && bRecs.length === 0) return 0;
            if (aRecs.length === 0) return 1;
            if (bRecs.length === 0) return -1;

            const aAvg = aRecs.reduce((sum, r) => sum + r.totalCE, 0) / aRecs.length;
            const bAvg = bRecs.reduce((sum, r) => sum + r.totalCE, 0) / bRecs.length;
            return bAvg - aAvg; // Descending
          }
          if (sortBy === 'performanceMonth') {
            const mNum = exportMonth !== '' ? Number(exportMonth) : new Date().getMonth() + 1;
            const yNum = exportMonth !== '' ? exportYear : new Date().getFullYear();

            const aRec = (a.ceRecords ?? []).find((r) => r.month === mNum && r.year === yNum);
            const bRec = (b.ceRecords ?? []).find((r) => r.month === mNum && r.year === yNum);

            const aVal = aRec ? aRec.totalCE : -1;
            const bVal = bRec ? bRec.totalCE : -1;
            return bVal - aVal; // Descending
          }
          return 0;
        });
      }
      
      const finalBatchName = `${batchName}${suffix}`;
      
      if (type === 'excel') exportBatchExcel(finalStudents, finalBatchName);
      else exportBatchPDF(finalStudents, finalBatchName);
    } catch {
      toast.error('Failed to fetch marks data');
    } finally {
      setExporting(false);
    }
  }

  function handleExportStudents(type: 'excel' | 'pdf') {
    if (!selectedBatch) return;
    const batchName = batches.find((b) => b.id === selectedBatch)?.name ?? 'batch';
    const rows = sortedStudents.map(s => ({
      regNumber: s.regNumber,
      fullName: s.fullName,
      batchName: s.batch?.name || '',
    }));
    if (type === 'excel') exportStudentsExcel(rows as any[], batchName);
    else exportStudentsPDF(rows as any[], batchName);
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeImage(file);
      setPhotoPreview(resized);
    } catch {
      toast.error('Failed to process image');
    }
    e.target.value = '';
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBatch) return;
    setSaving(true);
    try {
      await create({ ...form, batchId: selectedBatch, ...(photoPreview ? { photo: photoPreview } : {}) });
      setForm({ fullName: '', regNumber: '', password: '' });
      setPhotoPreview('');
      setShowForm(false);
      fetchByBatch(selectedBatch).catch(() => {});
      toast.success('Student added');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to add student');
    } finally { setSaving(false); }
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Students</h2>
          {selectedBatch && user?.role === 'TEACHER' && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium transition-colors"
            >
              {showForm ? 'Cancel' : '+ Add Student'}
            </button>
          )}
        </div>

        {/* Batch selector */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {visible.map((b) => {
            const tNames = user?.role === 'ADMIN' ? teachersForBatch(b.id) : [];
            const isSelected = selectedBatch === b.id;
            return (
              <button
                key={b.id}
                onClick={() => setParams({ batch: b.id })}
                className={`text-sm px-4 py-2 rounded-xl font-medium transition-colors text-left ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-500'
                }`}
              >
                <span className="block">{b.name}</span>
                {tNames.length > 0 && (
                  <span className={`block text-xs font-normal mt-0.5 ${isSelected ? 'text-indigo-200' : 'text-gray-400 dark:text-gray-500'}`}>
                    {tNames.join(', ')}
                  </span>
                )}
                {tNames.length === 0 && user?.role === 'ADMIN' && (
                  <span className={`block text-xs font-normal mt-0.5 ${isSelected ? 'text-indigo-300' : 'text-gray-300 dark:text-gray-600'}`}>
                    No teacher
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Batch Approval and Lock Manager Card */}
        {selectedBatch && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 mb-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-tight flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Batch CE Approval & Lock Status
                </h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  When approved & locked, teachers cannot add/edit/delete student tests or CE records.
                </p>
              </div>

              {/* Admin Form to Approve/Lock */}
              {user?.role === 'ADMIN' && (
                <form onSubmit={handleLockToggle} className="flex flex-wrap items-center gap-2">
                  <select
                    required
                    value={lockForm.month}
                    onChange={(e) => setLockForm({ ...lockForm, month: Number(e.target.value) })}
                    className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Month</option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{MONTHS[i + 1]}</option>
                    ))}
                  </select>
                  <select
                    required
                    value={lockForm.year}
                    onChange={(e) => setLockForm({ ...lockForm, year: Number(e.target.value) })}
                    className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Year</option>
                    {Array.from({ length: 5 }, (_, i) => {
                      const yr = new Date().getFullYear() - i;
                      return <option key={yr} value={yr}>{yr}</option>;
                    })}
                  </select>
                  <button
                    type="submit"
                    disabled={locking}
                    className="bg-indigo-600 text-white text-xs px-3.5 py-2 rounded-xl hover:bg-indigo-700 font-semibold transition-colors disabled:opacity-60 shadow-sm"
                  >
                    {locking ? 'Locking...' : 'Approve & Lock'}
                  </button>
                </form>
              )}
            </div>

            {/* List of Approved Months */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              {batchApprovals.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">No months are approved or locked for this batch yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {batchApprovals.map((a) => (
                    <div
                      key={`${a.month}-${a.year}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl text-xs text-emerald-700 dark:text-emerald-400 font-medium"
                    >
                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      {MONTHS[a.month]} {a.year}
                      {user?.role === 'ADMIN' && (
                        <button
                          onClick={() => handleUnlock(a.month, a.year)}
                          className="ml-1 text-emerald-500 hover:text-red-500 dark:hover:text-red-400 hover:scale-110 transition-all focus:outline-none"
                          title="Unlock month"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Export buttons */}
        {selectedBatch && students.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {user?.role === 'ADMIN' && (
              <>
                {/* Custom Month Filter Control Card */}
                <div className="flex flex-wrap items-center gap-2 border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 rounded-2xl px-3.5 py-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Export Coverage:</span>
                  <select
                    value={exportMonth}
                    onChange={(e) => setExportMonth(e.target.value)}
                    className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 font-medium"
                  >
                    <option value="">All Months</option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{MONTHS[i + 1]}</option>
                    ))}
                  </select>
                  {exportMonth && (
                    <select
                      value={exportYear}
                      onChange={(e) => setExportYear(Number(e.target.value))}
                      className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 font-medium"
                    >
                      {Array.from({ length: 5 }, (_, i) => {
                        const yr = new Date().getFullYear() - i;
                        return <option key={yr} value={yr}>{yr}</option>;
                      })}
                    </select>
                  )}
                  
                  <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 mx-1.5" />

                  <button
                    onClick={() => handleExportAllMarks('excel')}
                    disabled={exporting}
                    className="text-xs px-4 py-2 bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-900 rounded-xl text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 flex items-center gap-1.5 disabled:opacity-60 font-semibold shadow-sm transition-all">
                    {exporting ? '…' : '↓'} All Marks (Excel)
                  </button>
                  <button
                    onClick={() => handleExportAllMarks('pdf')}
                    disabled={exporting}
                    className="text-xs px-4 py-2 bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-900 rounded-xl text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 flex items-center gap-1.5 disabled:opacity-60 font-semibold shadow-sm transition-all">
                    {exporting ? '…' : '↓'} All Marks (PDF)
                  </button>
                </div>

                <button
                  onClick={() => handleExportStudents('excel')}
                  className="text-xs px-4 py-3.5 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1.5 font-medium">
                  ↓ Student List (Excel)
                </button>
                <button
                  onClick={() => handleExportStudents('pdf')}
                  className="text-xs px-4 py-3.5 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1.5 font-medium">
                  ↓ Student List (PDF)
                </button>
              </>
            )}
          </div>
        )}

        {showForm && user?.role === 'TEACHER' && (
          <form onSubmit={handleCreate} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 mb-4 space-y-4">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">New Student</p>

            {/* Photo upload */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                {photoPreview
                  ? <img src={photoPreview} alt="preview" className="w-full h-full object-cover" />
                  : <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
                }
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Photo <span className="text-gray-400">(optional)</span></label>
                <div className="flex gap-2">
                  <label className="cursor-pointer text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium transition-colors">
                    {photoPreview ? 'Change' : 'Upload'}
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
                  </label>
                  {photoPreview && (
                    <button type="button" onClick={() => setPhotoPreview('')} className="text-xs px-3 py-2 text-red-400 hover:text-red-600 dark:hover:text-red-400 font-medium">Remove</button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Full Name</label>
                <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Registration Number</label>
                <input required value={form.regNumber} onChange={(e) => setForm({ ...form, regNumber: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-indigo-600 dark:text-indigo-400 mb-1.5 font-bold italic">Dashboard Password</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} placeholder="Set student login password" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setPhotoPreview(''); }} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-2.5">Cancel</button>
            </div>
          </form>
        )}

        {!selectedBatch && <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">Select a batch above.</p>}
        {loading && <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p>}

        {selectedBatch && !loading && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {students.length === 0 ? (
              <EmptyState title="No students in this batch" description="Add students using the button above." icon="user" />
            ) : (
              <>
                {/* Admin Transfer Bar */}
                {user?.role === 'ADMIN' && selectedStudents.length > 0 && (
                  <div className="bg-indigo-50 dark:bg-indigo-950/20 border-b border-indigo-100 dark:border-indigo-900/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center bg-indigo-600 text-white rounded-full text-xs font-bold w-6 h-6 flex-shrink-0 shadow-sm">
                        {selectedStudents.length}
                      </span>
                      <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">
                        Students selected for transfer based on performance
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        required
                        value={transferTargetBatch}
                        onChange={(e) => setTransferTargetBatch(e.target.value)}
                        className="border border-indigo-300 dark:border-indigo-800 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                      >
                        <option value="">Select Target Batch</option>
                        {batches.filter((b) => b.id !== selectedBatch).map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleTransferSubmit}
                        disabled={transferring}
                        className="bg-indigo-600 text-white text-xs px-4 py-2 rounded-xl hover:bg-indigo-700 font-bold transition-colors shadow-sm disabled:opacity-60"
                      >
                        {transferring ? 'Transferring...' : 'Transfer Selected'}
                      </button>
                    </div>
                  </div>
                )}
                
                {/* Sort Controls Bar */}
                <div className="bg-gray-50/50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-700 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-indigo-500 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                    </svg>
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Sort Students:</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 font-semibold text-gray-700 dark:text-gray-300"
                    >
                      <option value="default">Default Order</option>
                      <option value="name">Name (A to Z)</option>
                      <option value="reg">Register Number (Numerical)</option>
                      <option value="performanceAll">Highest Performer (All Months)</option>
                      <option value="performanceMonth">Highest Performer ({exportMonth !== '' ? `${MONTHS[Number(exportMonth)]} ${exportYear}` : 'Current Month'})</option>
                    </select>
                  </div>
                </div>

                {/* Mobile card list */}
                <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                  {sortedStudents.map((s: Student) => {
                    const recs = s.ceRecords ?? [];
                    const total = recs.reduce((acc: number, r: any) => acc + r.totalCE, 0);
                    const trend = recs.length >= 2 ? recs[0].totalCE - recs[1].totalCE : null;
                    return (
                      <div key={s.id} className="flex items-center gap-3 px-4 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 active:bg-gray-100 dark:active:bg-gray-700/50">
                        {user?.role === 'ADMIN' && (
                          <input
                            type="checkbox"
                            checked={selectedStudents.includes(s.id)}
                            onChange={() => toggleStudentSelection(s.id)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                          />
                        )}
                        <Link to={`/students/${s.id}`} className="flex-1 flex items-center justify-between">
                          <div>
                            <p className="font-medium text-gray-800 dark:text-gray-100">{s.fullName}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono">
                              {s.regNumber} &middot; {s.batch?.name ?? '—'}
                              {recs.length > 0 && user?.role === 'ADMIN' && (
                                <span className="ml-2 font-medium font-sans inline-flex items-center gap-1">
                                  CE: <span className={
                                    (total / recs.length) >= 15 ? 'text-green-600 dark:text-green-400 font-bold'
                                    : (total / recs.length) >= 10 ? 'text-yellow-600 dark:text-yellow-400 font-bold'
                                    : 'text-red-600 dark:text-red-400 font-bold'
                                  }>{total.toFixed(1)} / {recs.length * 20}</span>
                                  {trend !== null && (
                                    <span className={`font-bold ${trend > 0 ? 'text-emerald-500' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                      {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'}
                                    </span>
                                  )}
                                </span>
                              )}
                            </p>
                          </div>
                          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" className="text-gray-300 dark:text-gray-600 flex-shrink-0">
                            <polyline points="9 18 15 12 9 6"/>
                          </svg>
                        </Link>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <tr>
                        {user?.role === 'ADMIN' && (
                          <th className="px-4 py-3 w-12 text-left">
                            <input
                              type="checkbox"
                              checked={selectedStudents.length === students.length && students.length > 0}
                              onChange={toggleAllStudents}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                            />
                          </th>
                        )}
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Reg No.</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Name</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Batch</th>
                        {user?.role === 'ADMIN' && <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Cumulative CE</th>}
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {sortedStudents.map((s: Student) => {
                        const recs = s.ceRecords ?? [];
                        const total = recs.reduce((acc: number, r: any) => acc + r.totalCE, 0);
                        const trend = recs.length >= 2 ? recs[0].totalCE - recs[1].totalCE : null;
                        return (
                          <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            {user?.role === 'ADMIN' && (
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={selectedStudents.includes(s.id)}
                                  onChange={() => toggleStudentSelection(s.id)}
                                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                                />
                              </td>
                            )}
                            <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">{s.regNumber}</td>
                            <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{s.fullName}</td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{s.batch?.name ?? '—'}</td>
                            {user?.role === 'ADMIN' && (
                              <td className="px-4 py-3">
                                {recs.length > 0 ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                      (total / recs.length) >= 15 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                                      : (total / recs.length) >= 10 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
                                      : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                                    }`}>
                                      {total.toFixed(1)} / {recs.length * 20}
                                    </span>
                                    {trend !== null && (
                                      <span className={`text-sm font-bold ${trend > 0 ? 'text-emerald-500' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                        {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'}
                                      </span>
                                    )}
                                  </span>
                                ) : <span className="text-gray-400 dark:text-gray-500">—</span>}
                              </td>
                            )}
                            <td className="px-4 py-3 text-right">
                              <Link to={`/students/${s.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">View</Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
