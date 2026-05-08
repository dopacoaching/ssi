import { useEffect, useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { RootState } from '../store';
import { useStudents, Student } from '../hooks/useStudents';
import { useCE, CERecord } from '../hooks/useCE';
import { useTests, WeeklyTest, MonthlyTest } from '../hooks/useTests';
import { useRemarks } from '../hooks/useRemarks';
import Layout from '../components/Layout';
import CEForm from './CEForm';
import StudentPortal from './StudentPortal';
import ConfirmModal from '../components/ConfirmModal';
import EmptyState from '../components/EmptyState';
import {
  exportWeeklyExcel,  exportMonthlyExcel,
  exportWeeklyPDF,    exportMonthlyPDF,
  exportCEExcel,      exportCEPDF,
  exportReportCardPDF,
} from '../utils/exportUtils';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Tab = 'report' | 'ce' | 'weekly' | 'monthly' | 'remarks';

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
const cardCls  = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4';
const filterSelectCls = 'text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400';
const exportBtnCls = 'text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1';

export default function StudentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const isTeacher = user?.role === 'TEACHER';
  const isStaff   = user?.role === 'ADMIN' || user?.role === 'TEACHER';
  const { fetchOne, update, updatePhoto, remove } = useStudents();
  const { records, loading: ceLoading, fetch: fetchCE, remove: deleteCE }                       = useCE(id!);
  const { weekly, monthly, loading: testLoading, fetchAll, addWeekly, addMonthly, updateWeekly, deleteWeekly, updateMonthly, deleteMonthly }     = useTests(id!);
  const { remarks, loading: remarkLoading, fetch: fetchRemarks, add: addRemark, flag } = useRemarks(id!);

  const [student, setStudent]       = useState<Student | null>(null);
  const [studentError, setStudentError] = useState(false);
  const [tab, setTab]               = useState<Tab>((user?.role as string) === 'STUDENT' ? 'report' : 'ce');
  const [showCEForm, setShowCEForm] = useState(false);

  const [editingStudent, setEditingStudent]       = useState(false);
  const [editStudentForm, setEditStudentForm]     = useState({ 
    fullName: '', regNumber: '', password: '' 
  });
  const [editStudentSaving, setEditStudentSaving] = useState(false);

  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating]           = useState(false);
  const [photoUploading, setPhotoUploading]       = useState(false);

  const [showWForm, setShowWForm] = useState(false);
  const [wForm, setWForm] = useState({ weekDate: '', testType: 'Theory', subject: 'Physics', chapter: '', marks: '', maxMarks: '100' });
  const [wSaving, setWSaving] = useState(false);
  const [wFilter, setWFilter] = useState({ month: '', year: '' });

  const [showMForm, setShowMForm] = useState(false);
  const [mForm, setMForm] = useState({ month: '', year: new Date().getFullYear().toString(), testType: 'Theory', subject: 'Physics', marks: '', maxMarks: '100' });
  const [mSaving, setMSaving] = useState(false);
  const [mFilter, setMFilter] = useState({ month: '', year: '' });

  const [showRForm, setShowRForm] = useState(false);
  const [rForm, setRForm] = useState({ category: '', text: '', isFlagged: false });
  const [rSaving, setRSaving] = useState(false);

  const [ceFilter, setCEFilter] = useState({ month: '', year: '' });

  const [editingWId, setEditingWId] = useState<string | null>(null);
  const [editWForm, setEditWForm]   = useState({ marks: '', maxMarks: '', chapter: '' });
  const [editingMId, setEditingMId] = useState<string | null>(null);
  const [editMForm, setEditMForm]   = useState({ marks: '', maxMarks: '' });

  function isApprovedMonth(month: number, year: number) {
    const rec = records.find((r) => r.month === month && r.year === year);
    return rec ? !!rec.isApproved : false;
  }

  function downloadCompleteDossier() {
    if (!student) return;
    const name = student.fullName;
    let count = 0;
    
    if (records.length > 0) {
      exportReportCardPDF({ student: student as any, ceRecords: records, remarks });
      exportCEExcel(records, name);
      count += 2;
    }
    if (weekly.length > 0) {
      exportWeeklyExcel(weekly, name);
      count++;
    }
    if (monthly.length > 0) {
      exportMonthlyExcel(monthly, name);
      count++;
    }
    
    if (count > 0) {
      toast.success(`Dossier exported: ${count} report files downloaded!`);
    } else {
      toast.error('No evaluation records available to export.');
    }
  }



  async function handleUpdateWeekly(testId: string) {
    try {
      await updateWeekly(testId, {
        marks: Number(editWForm.marks),
        maxMarks: Number(editWForm.maxMarks),
        chapter: editWForm.chapter,
      });
      setEditingWId(null);
      fetchAll().catch(() => {});
      fetchCE().catch(() => {});
      toast.success('Weekly test updated');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update test');
    }
  }

  async function handleDeleteWeekly(testId: string) {
    if (!window.confirm('Are you sure you want to delete this weekly test?')) return;
    try {
      await deleteWeekly(testId);
      fetchAll().catch(() => {});
      fetchCE().catch(() => {});
      toast.success('Weekly test deleted');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to delete test');
    }
  }

  async function handleUpdateMonthly(testId: string) {
    try {
      await updateMonthly(testId, {
        marks: Number(editMForm.marks),
        maxMarks: Number(editMForm.maxMarks),
      });
      setEditingMId(null);
      fetchAll().catch(() => {});
      fetchCE().catch(() => {});
      toast.success('Monthly test updated');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update test');
    }
  }

  async function handleDeleteMonthly(testId: string) {
    if (!window.confirm('Are you sure you want to delete this monthly test?')) return;
    try {
      await deleteMonthly(testId);
      fetchAll().catch(() => {});
      fetchCE().catch(() => {});
      toast.success('Monthly test deleted');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to delete test');
    }
  }

  async function handleDeleteCE(ceId: string) {
    if (!window.confirm('Are you sure you want to delete this CE record?')) return;
    try {
      await deleteCE(ceId);
      fetchCE().catch(() => {});
      toast.success('CE record deleted');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to delete CE record');
    }
  }

  useEffect(() => {
    if (!id) return;
    fetchOne(id).then((s) => {
      if (s === null) setStudentError(true);
      else setStudent(s);
    });
    fetchCE().catch(() => {});
    fetchAll().catch(() => {});
    fetchRemarks().catch(() => {});
  }, [id, fetchOne, fetchCE, fetchAll, fetchRemarks]);

  function openEditStudent(s: Student) {
    setEditStudentForm({ 
      fullName: (s as any).fullName, regNumber: (s as any).regNumber,
      password: ''
    });
    setEditingStudent(true);
    setConfirmDeactivate(false);
  }

  async function handleEditStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setEditStudentSaving(true);
    try {
      await update(id, editStudentForm);
      const refreshed = await fetchOne(id);
      setStudent(refreshed);
      setEditingStudent(false);
      toast.success('Student updated');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update student');
    } finally { setEditStudentSaving(false); }
  }

  async function handleDeactivate() {
    if (!id) return;
    setDeactivating(true);
    try {
      await remove(id);
      toast.success('Student deactivated');
      navigate('/students');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to deactivate student');
      setDeactivating(false);
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setPhotoUploading(true);
    try {
      await updatePhoto(id, file);
      const refreshed = await fetchOne(id);
      setStudent(refreshed);
      toast.success('Photo updated');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update photo');
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  }

  async function handleAddWeekly(e: React.FormEvent) {
    e.preventDefault(); setWSaving(true);
    try {
      await addWeekly({ ...wForm, marks: Number(wForm.marks), maxMarks: Number(wForm.maxMarks) });
      setWForm({ weekDate: '', testType: 'Theory', subject: 'Physics', chapter: '', marks: '', maxMarks: '100' });
      setShowWForm(false);
      fetchAll().catch(() => {});
      fetchCE().catch(() => {});
      toast.success('Weekly test added');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to add test');
    } finally { setWSaving(false); }
  }

  async function handleAddMonthly(e: React.FormEvent) {
    e.preventDefault();
    const now = new Date();
    const y = Number(mForm.year), m = Number(mForm.month);
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) {
      toast.error('Cannot add records for a future month');
      return;
    }
    setMSaving(true);
    try {
      await addMonthly({ ...mForm, month: m, year: y, marks: Number(mForm.marks), maxMarks: Number(mForm.maxMarks) });
      setMForm({ month: '', year: new Date().getFullYear().toString(), testType: 'Theory', subject: 'Physics', marks: '', maxMarks: '100' });
      setShowMForm(false);
      fetchAll().catch(() => {});
      fetchCE().catch(() => {});
      toast.success('Monthly test added');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to add test');
    } finally { setMSaving(false); }
  }

  async function handleAddRemark(e: React.FormEvent) {
    e.preventDefault(); setRSaving(true);
    try {
      await addRemark(rForm);
      setRForm({ category: '', text: '', isFlagged: false });
      setShowRForm(false);
      fetchRemarks().catch(() => {});
      toast.success('Remark added');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to add remark');
    } finally { setRSaving(false); }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'report' as Tab,  label: 'Progress Report' },
    ...(isStaff ? [{ key: 'ce' as Tab, label: 'CE Records' }] : []),
    { key: 'weekly' as Tab,  label: 'Weekly Tests' },
    { key: 'monthly' as Tab, label: 'Monthly Tests' },
    { key: 'remarks' as Tab, label: 'Remarks' },
  ];

  const studentName = student?.fullName ?? 'student';

  const filteredWeekly = useMemo(() => weekly.filter((t) => {
    const d = new Date(t.weekDate);
    if (wFilter.month && d.getMonth() + 1 !== Number(wFilter.month)) return false;
    if (wFilter.year  && d.getFullYear()  !== Number(wFilter.year))  return false;
    return true;
  }), [weekly, wFilter.month, wFilter.year]);

  const filteredMonthly = useMemo(() => monthly.filter((t) => {
    if (mFilter.month && t.month !== Number(mFilter.month)) return false;
    if (mFilter.year  && t.year  !== Number(mFilter.year))  return false;
    return true;
  }), [monthly, mFilter.month, mFilter.year]);

  const filteredCE = useMemo(() => records.filter((r) => {
    if (ceFilter.month && r.month !== Number(ceFilter.month)) return false;
    if (ceFilter.year  && r.year  !== Number(ceFilter.year))  return false;
    return true;
  }), [records, ceFilter.month, ceFilter.year]);

  const filteredWeeklyTheory  = useMemo(() => filteredWeekly.filter(t => t.testType === 'Theory'), [filteredWeekly]);
  const filteredWeeklyMCQ     = useMemo(() => filteredWeekly.filter(t => t.testType === 'MCQ'),    [filteredWeekly]);
  const filteredMonthlyTheory = useMemo(() => filteredMonthly.filter(t => t.testType === 'Theory'), [filteredMonthly]);
  const filteredMonthlyMCQ    = useMemo(() => filteredMonthly.filter(t => t.testType === 'MCQ'),    [filteredMonthly]);

  const weeklyTheory  = useMemo(() => weekly.filter(t => t.testType === 'Theory'),  [weekly]);
  const weeklyMCQ     = useMemo(() => weekly.filter(t => t.testType === 'MCQ'),     [weekly]);
  const monthlyTheory = useMemo(() => monthly.filter(t => t.testType === 'Theory'), [monthly]);
  const monthlyMCQ    = useMemo(() => monthly.filter(t => t.testType === 'MCQ'),    [monthly]);

  function filterLabel(month: string, year: string) {
    if (!month && !year) return '';
    const m = month ? MONTHS[Number(month)] : '';
    return [m, year].filter(Boolean).join('_');
  }

  if ((user?.role as string) === 'STUDENT') {
    return <StudentPortal />;
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-4">
          {isStaff && (
            <Link to="/students" className="inline-flex items-center gap-1 text-sm text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              Back to Students
            </Link>
          )}
        </div>

        {/* Student card */}
        {studentError ? (
          <div className={`${cardCls} mb-5 text-sm text-red-600 dark:text-red-400`}>
            Student not found or you do not have access.
          </div>
        ) : student ? (
          <div className={`${cardCls} mb-5`}>
            {editingStudent ? (
              <form onSubmit={handleEditStudent} className="space-y-3">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Edit Student</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Full Name</label>
                    <input required value={editStudentForm.fullName}
                      onChange={(e) => setEditStudentForm({ ...editStudentForm, fullName: e.target.value })}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Registration Number</label>
                    <input required value={editStudentForm.regNumber}
                      onChange={(e) => setEditStudentForm({ ...editStudentForm, regNumber: e.target.value })}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-indigo-600 dark:text-indigo-400 mb-1.5 font-bold italic">Update Password</label>
                    <input type="password" value={editStudentForm.password}
                      onChange={(e) => setEditStudentForm({ ...editStudentForm, password: e.target.value })}
                      className={inputCls} placeholder="Leave blank to keep current" />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={editStudentSaving}
                    className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                    {editStudentSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditingStudent(false)}
                    className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-2.5">Cancel</button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between flex-wrap gap-4">
                {/* Avatar + info */}
                <div className="flex items-start gap-4">
                  {/* Photo avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-gray-200 dark:border-gray-600 bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                      {student.photo
                        ? <img src={student.photo} alt={student.fullName} className="w-full h-full object-cover" />
                        : <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 select-none">
                            {student.fullName.charAt(0).toUpperCase()}
                          </span>
                      }
                    </div>
                    {/* Camera button — teacher only */}
                    {isTeacher && (
                      <label className={`absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 flex items-center justify-center cursor-pointer shadow-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors ${photoUploading ? 'opacity-50 pointer-events-none' : ''}`} title="Change photo">
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} disabled={photoUploading} />
                        {photoUploading
                          ? <svg className="w-3 h-3 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                          : <svg className="w-3 h-3 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3"/></svg>
                        }
                      </label>
                    )}
                  </div>

                  <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-3">
                      {student.fullName}
                      {user?.role === 'ADMIN' && records.length > 0 && (
                        <span className={`text-sm px-2.5 py-1 rounded-full font-bold ${
                          (records.reduce((a, r) => a + r.totalCE, 0) / records.length) >= 15 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                          : (records.reduce((a, r) => a + r.totalCE, 0) / records.length) >= 10 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
                          : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                        }`}>
                          Cumulative CE: {records.reduce((a, r) => a + r.totalCE, 0).toFixed(1)} / {records.length * 20}
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Reg: <span className="font-mono font-medium">{student.regNumber}</span>
                      <span className="mx-2 text-gray-300 dark:text-gray-600">·</span>
                      Batch: <span className="font-medium text-gray-700 dark:text-gray-300">{student.batch?.name}</span>
                    </p>
                    {user?.role === 'ADMIN' && (
                      <div className="mt-3.5">
                        <button
                          onClick={downloadCompleteDossier}
                          className="text-xs bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 font-semibold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 shadow-sm hover:shadow-md"
                        >
                          <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          One-Click Download All Reports (Dossier)
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isTeacher && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => openEditStudent(student)}
                      className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium px-2 py-1">Edit</button>
                    <button onClick={() => setConfirmDeactivate(true)}
                      className="text-sm text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1">Deactivate</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="h-24 bg-gray-100 dark:bg-gray-700 rounded-2xl mb-5 animate-pulse" />
        )}

        <ConfirmModal
          open={confirmDeactivate}
          title="Deactivate Student"
          message={`${student?.fullName ?? 'This student'} will be removed from the system. All records are preserved.`}
          confirmLabel="Deactivate"
          danger
          loading={deactivating}
          onConfirm={handleDeactivate}
          onCancel={() => setConfirmDeactivate(false)}
        />

        {/* Tabs */}
        <div className="flex gap-1 mb-4 overflow-x-auto pb-px">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-xl transition-colors whitespace-nowrap ${
                tab === t.key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* CE Tab */}
        {/* Progress Report Tab */}
        {tab === 'report' && (
          <div className="space-y-6">
            {/* Report card download (ADMIN only) */}
            {user?.role === 'ADMIN' && student && records.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={() => exportReportCardPDF({ student: student as any, ceRecords: records, remarks })}
                  className="text-sm px-4 py-2 border border-indigo-300 dark:border-indigo-600 rounded-xl text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 font-medium flex items-center gap-1.5">
                  ↓ Download Report Card
                </button>
              </div>
            )}
            {/* Quick Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {user?.role === 'ADMIN' && (
                <div className={cardCls}>
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider mb-1">Cumulative CE</p>
                  <div className="flex items-end gap-2">
                    <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                      {records.length > 0 ? records.reduce((a, r) => a + r.totalCE, 0).toFixed(1) : '—'}
                    </p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">/ {records.length * 20}</p>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-full rounded-full transition-all duration-500" 
                      style={{ width: `${records.length > 0 ? ((records.reduce((a, r) => a + r.totalCE, 0) / records.length) / 20) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              <div className={cardCls}>
                <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider mb-1">Attendance Rate</p>
                <div className="flex items-end gap-2">
                  <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                    {records.length > 0 ? (records.reduce((a, r) => a + r.attendancePct, 0) / records.length).toFixed(0) : '—'}
                  </p>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">%</p>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full mt-3 overflow-hidden">
                  <div 
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${records.length > 0 ? (records.reduce((a, r) => a + r.attendancePct, 0) / records.length) : 0}%` }}
                  />
                </div>
              </div>

              <div className={`${cardCls} ${user?.role !== 'ADMIN' ? 'sm:col-span-2' : ''}`}>
                <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider mb-1">Total Tests</p>
                <div className="flex items-end gap-2">
                  <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">{weekly.length + monthly.length}</p>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">completed</p>
                </div>
                <p className="text-[10px] text-gray-400 mt-3">{monthly.length} Monthly &middot; {weekly.length} Weekly</p>
              </div>
            </div>

            {/* Subject-wise Performance */}
            {records.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-tight">Subject-wise Average</h3>
                <div className={`${cardCls} grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-6`}>
                  {[
                    { label: 'Physics',   key: 'physics' },
                    { label: 'Chemistry', key: 'chem' },
                    { label: 'Math',      key: 'math' },
                    { label: 'Biology',   key: 'bio' },
                    { label: 'Language 1', key: 'lang1' },
                    { label: 'Language 2', key: 'lang2' },
                    { label: 'Psychology', key: 'psychology' },
                  ].map((s) => {
                    const avg = records.reduce((acc, r) => {
                      const marks = (r as any)[`${s.key}Marks`] as number;
                      const max = (r as any)[`${s.key}Max`] as number;
                      return acc + (max > 0 ? (marks / max) * 100 : 0);
                    }, 0) / records.length;
                    
                    return (
                      <div key={s.key} className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-medium text-gray-600 dark:text-gray-400">{s.label}</span>
                          <span className="font-bold text-gray-800 dark:text-gray-100">{avg.toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-700 h-2 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-700 ${avg >= 75 ? 'bg-emerald-500' : avg >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} 
                            style={{ width: `${avg}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CE Trend Chart */}
            {records.length >= 2 && (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-4">CE Score Over Time</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart
                    data={[...records]
                      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
                      .map(r => ({ name: `${MONTHS[r.month]} ${r.year}`, ce: r.totalCE, att: r.attendancePct }))}
                    margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                    <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }} />
                    <YAxis domain={[0, 20]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={10} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.5} />
                    <Line type="monotone" dataKey="ce" stroke="#6366f1" strokeWidth={2} dot={{ r: 4, fill: '#6366f1' }} name="CE (/20)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="space-y-8">
              {/* Monthly Performance Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-1 bg-indigo-600 rounded-full" />
                  <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wider">Monthly Performance</h3>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Monthly Theory */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase">Latest Theory</h4>
                      <button onClick={() => setTab('monthly')} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">View All</button>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                      {monthlyTheory.length === 0 ? (
                        <p className="p-6 text-sm text-gray-400 text-center">No theory tests yet.</p>
                      ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                          {monthlyTheory.slice(0, 3).map((t) => (
                            <div key={t.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                              <div>
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t.subject}</p>
                                <p className="text-xs text-gray-400">{MONTHS[t.month]} {t.year}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t.marks} / {t.maxMarks}</p>
                                <p className={`text-[10px] font-bold ${ (t.marks/t.maxMarks) >= 0.8 ? 'text-emerald-500' : (t.marks/t.maxMarks) >= 0.5 ? 'text-amber-500' : 'text-red-500' }`}>
                                  {((t.marks / t.maxMarks) * 100).toFixed(0)}%
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Monthly MCQ */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase">Latest MCQ</h4>
                      <button onClick={() => setTab('monthly')} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">View All</button>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                      {monthlyMCQ.length === 0 ? (
                        <p className="p-6 text-sm text-gray-400 text-center">No MCQ tests yet.</p>
                      ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                          {monthlyMCQ.slice(0, 3).map((t) => (
                            <div key={t.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                              <div>
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t.subject}</p>
                                <p className="text-xs text-gray-400">{MONTHS[t.month]} {t.year}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t.marks} / {t.maxMarks}</p>
                                <p className={`text-[10px] font-bold ${ (t.marks/t.maxMarks) >= 0.8 ? 'text-emerald-500' : (t.marks/t.maxMarks) >= 0.5 ? 'text-amber-500' : 'text-red-500' }`}>
                                  {((t.marks / t.maxMarks) * 100).toFixed(0)}%
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Weekly Performance Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-1 bg-amber-500 rounded-full" />
                  <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wider">Weekly Performance</h3>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Weekly Theory */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase">Latest Theory</h4>
                      <button onClick={() => setTab('weekly')} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">View All</button>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                      {weeklyTheory.length === 0 ? (
                        <p className="p-6 text-sm text-gray-400 text-center">No theory tests yet.</p>
                      ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                          {weeklyTheory.slice(0, 3).map((t) => (
                            <div key={t.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                              <div>
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t.subject}</p>
                                <p className="text-xs text-gray-400">{new Date(t.weekDate).toLocaleDateString()}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t.marks} / {t.maxMarks}</p>
                                <p className="text-[10px] font-medium text-gray-400">{((t.marks / t.maxMarks) * 100).toFixed(0)}%</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Weekly MCQ */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase">Latest MCQ</h4>
                      <button onClick={() => setTab('weekly')} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">View All</button>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                      {weeklyMCQ.length === 0 ? (
                        <p className="p-6 text-sm text-gray-400 text-center">No MCQ tests yet.</p>
                      ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                          {weeklyMCQ.slice(0, 3).map((t) => (
                            <div key={t.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                              <div>
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t.subject}</p>
                                <p className="text-xs text-gray-400">{new Date(t.weekDate).toLocaleDateString()}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t.marks} / {t.maxMarks}</p>
                                <p className="text-[10px] font-medium text-gray-400">{((t.marks / t.maxMarks) * 100).toFixed(0)}%</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Latest Remarks */}
            {remarks.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-tight">Latest Teacher Feedback</h3>
                <div className={`p-5 rounded-2xl border-l-4 ${remarks[0].isFlagged ? 'bg-red-50 dark:bg-red-900/10 border-red-500' : 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-500'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">{remarks[0].category}</span>
                    <span className="text-[10px] text-gray-400">{new Date(remarks[0].createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 italic">"{remarks[0].text}"</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CE Tab */}
        {tab === 'ce' && (
          <div>
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <div className="flex flex-wrap gap-2 items-center">
                <select value={ceFilter.month} onChange={(e) => setCEFilter({ ...ceFilter, month: e.target.value })}
                  className={filterSelectCls}>
                  <option value="">All months</option>
                  {MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                </select>
                <input type="number" placeholder="Year" value={ceFilter.year}
                  onChange={(e) => setCEFilter({ ...ceFilter, year: e.target.value })}
                  className={`${filterSelectCls} w-24`} />
                {(ceFilter.month || ceFilter.year) && (
                  <button onClick={() => setCEFilter({ month: '', year: '' })} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-2">Clear</button>
                )}
                {user?.role === 'ADMIN' && filteredCE.length > 0 && (
                  <>
                    <button onClick={() => exportCEExcel(filteredCE, `${studentName}${filterLabel(ceFilter.month, ceFilter.year) ? '_' + filterLabel(ceFilter.month, ceFilter.year) : ''}`)}
                      className={exportBtnCls}>↓ Excel</button>
                    <button onClick={() => exportCEPDF(filteredCE, `${studentName}${filterLabel(ceFilter.month, ceFilter.year) ? '_' + filterLabel(ceFilter.month, ceFilter.year) : ''}`)}
                      className={exportBtnCls}>↓ PDF</button>
                  </>
                )}
              </div>
              {isTeacher && (
                <button onClick={() => setShowCEForm(!showCEForm)}
                  className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium">
                  {showCEForm ? 'Cancel' : '+ Update Attendance & Notes'}
                </button>
              )}
            </div>

            {isTeacher && showCEForm && (
              <CEForm
                studentId={id!}
                existingRecords={records}
                onSaved={() => { setShowCEForm(false); fetchCE(); }}
              />
            )}

            {ceLoading ? <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p> : (
              <div className="space-y-3">
                {records.length === 0
                  ? <EmptyState title="No CE records yet" description={isStaff ? "Add test marks or click '+ Update Attendance & Notes' to generate the first record." : "No records available."} icon="document" />
                  : filteredCE.length === 0
                  ? <p className="text-sm text-gray-400 dark:text-gray-500">No records match the selected filter.</p>
                  : filteredCE.map((r) => (
                    <div key={r.id} className={cardCls}>
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-semibold text-gray-800 dark:text-gray-100 text-base">{MONTHS[r.month]} {r.year}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Added {new Date(r.createdAt).toLocaleDateString()}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold flex items-center gap-1 border ${
                            r.isApproved
                              ? 'bg-emerald-50/50 border-emerald-100 text-emerald-600 dark:bg-emerald-950/10 dark:border-emerald-900/20 dark:text-emerald-500'
                              : 'bg-amber-50/50 border-amber-100 text-amber-600 dark:bg-amber-950/10 dark:border-amber-900/20 dark:text-amber-500'
                          }`}>
                            {r.isApproved ? (
                              <>
                                <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg> Approved
                              </>
                            ) : (
                              <>
                                <svg className="w-3 h-3 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                </svg> Open for Edit
                              </>
                            )}
                          </span>
                          {isTeacher && !r.isApproved && (
                            <button
                              onClick={() => handleDeleteCE(r.id)}
                              className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 font-semibold px-2 py-1 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-xl transition-all"
                            >
                              Delete
                            </button>
                          )}
                          <span className={`text-base font-bold px-3 py-1 rounded-full ${
                            r.totalCE >= 15 ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                            : r.totalCE >= 10 ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400'
                            : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                          }`}>
                            {r.totalCE.toFixed(1)} / 20
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-sm">
                        {([['Theory', r.theoryScore, 10], ['MCQ', r.mcqScore, 5], ['Attend.', r.attendScore, 3], ['Notes', r.notesScore, 2]] as [string, number, number][]).map(([label, val, max]) => (
                          <div key={label} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-2.5 text-center">
                            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{label}</p>
                            <p className="font-semibold text-gray-700 dark:text-gray-200">{val.toFixed(1)}<span className="text-xs font-normal text-gray-400 dark:text-gray-500">/{max}</span></p>
                            {label === 'MCQ' && r.mcqMax > 0 && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{r.mcqMarks}/{r.mcqMax}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        )}

        {/* Weekly Tests Tab */}
        {tab === 'weekly' && (
          <div>
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <div className="flex flex-wrap gap-2 items-center">
                <select value={wFilter.month} onChange={(e) => setWFilter({ ...wFilter, month: e.target.value })}
                  className={filterSelectCls}>
                  <option value="">All months</option>
                  {MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                </select>
                <input type="number" placeholder="Year" value={wFilter.year}
                  onChange={(e) => setWFilter({ ...wFilter, year: e.target.value })}
                  className={`${filterSelectCls} w-24`} />
                {(wFilter.month || wFilter.year) && (
                  <button onClick={() => setWFilter({ month: '', year: '' })} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-2">Clear</button>
                )}
              </div>
              {isTeacher && (
                <button onClick={() => setShowWForm(!showWForm)}
                  className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium">
                  {showWForm ? 'Cancel' : '+ Add Weekly Test'}
                </button>
              )}
            </div>

            {isTeacher && showWForm && (
              <form onSubmit={handleAddWeekly} className={`${cardCls} mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3`}>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Date</label>
                  <input type="date" required value={wForm.weekDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setWForm({ ...wForm, weekDate: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Test Type</label>
                  <select required value={wForm.testType} onChange={(e) => setWForm({ ...wForm, testType: e.target.value })} className={inputCls}>
                    <option value="Theory">Theory</option>
                    <option value="MCQ">MCQ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Subject</label>
                  <select required value={wForm.subject} onChange={(e) => setWForm({ ...wForm, subject: e.target.value })} className={inputCls}>
                    <option value="Physics">Physics</option>
                    <option value="Chemistry">Chemistry</option>
                    <option value="Math">Math</option>
                    <option value="Biology">Biology</option>
                    <option value="Language 1">Language 1</option>
                    <option value="Language 2">Language 2</option>
                    <option value="Psychology">Psychology</option>
                    {wForm.testType === 'MCQ' && <option value="General MCQ">General MCQ</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Chapter (Optional)</label>
                  <input type="text" value={wForm.chapter} onChange={(e) => setWForm({ ...wForm, chapter: e.target.value })} className={inputCls} placeholder="e.g. Kinematics" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Marks</label>
                  <input type="number" required value={wForm.marks} onChange={(e) => setWForm({ ...wForm, marks: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Max Marks</label>
                  <input type="number" required value={wForm.maxMarks} onChange={(e) => setWForm({ ...wForm, maxMarks: e.target.value })} className={inputCls} />
                </div>
                {wForm.weekDate && isApprovedMonth(new Date(wForm.weekDate).getMonth() + 1, new Date(wForm.weekDate).getFullYear()) && isTeacher && (
                  <div className="col-span-full text-xs text-red-700 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-900/20 px-3 py-2.5 rounded-xl flex items-center gap-1.5 border border-red-150 dark:border-red-900/40">
                    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    This month has been approved by admin and is locked. You cannot add tests for this month.
                  </div>
                )}
                <div className="col-span-full">
                  <button type="submit" disabled={wSaving || (wForm.weekDate ? isApprovedMonth(new Date(wForm.weekDate).getMonth() + 1, new Date(wForm.weekDate).getFullYear()) && isTeacher : false)}
                    className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                    {wSaving ? 'Saving…' : 'Add'}
                  </button>
                </div>
              </form>
            )}

            {testLoading ? <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p> : weekly.length === 0 ? (
              <EmptyState title="No weekly tests yet" description="Click '+ Add Weekly Test' to add the first result." icon="chart" />
            ) : (
              <div>
                {user?.role === 'ADMIN' && filteredWeekly.length > 0 && (
                  <div className="flex justify-end gap-2 mb-2">
                    <button onClick={() => exportWeeklyExcel(filteredWeekly, `${studentName}${filterLabel(wFilter.month, wFilter.year) ? '_' + filterLabel(wFilter.month, wFilter.year) : ''}`)}
                      className={exportBtnCls}>↓ Excel</button>
                    <button onClick={() => exportWeeklyPDF(filteredWeekly, `${studentName}${filterLabel(wFilter.month, wFilter.year) ? '_' + filterLabel(wFilter.month, wFilter.year) : ''}`)}
                      className={exportBtnCls}>↓ PDF</button>
                  </div>
                )}
                {filteredWeekly.length === 0
                  ? <p className="text-sm text-gray-400 dark:text-gray-500">No tests match the selected filter.</p>
                  : (
                    <div className="space-y-8">
                      {/* Theory Section */}
                      {filteredWeeklyTheory.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500" />
                            Theory Tests
                          </h3>
                          <div className="sm:hidden space-y-2">
                            {filteredWeeklyTheory.map((t) => {
                              const isEditing = editingWId === t.id;
                              return (
                                <div key={t.id} className={cardCls}>
                                  {isEditing ? (
                                    <div className="space-y-3">
                                      <div>
                                        <label className="block text-xs text-gray-400 mb-1">Chapter</label>
                                        <input value={editWForm.chapter} onChange={e => setEditWForm({ ...editWForm, chapter: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                      </div>
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="block text-xs text-gray-400 mb-1">Marks</label>
                                          <input type="number" value={editWForm.marks} onChange={e => setEditWForm({ ...editWForm, marks: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                        </div>
                                        <div>
                                          <label className="block text-xs text-gray-400 mb-1">Max Marks</label>
                                          <input type="number" value={editWForm.maxMarks} onChange={e => setEditWForm({ ...editWForm, maxMarks: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                        </div>
                                      </div>
                                      <div className="flex gap-2 justify-end pt-1">
                                        <button onClick={() => handleUpdateWeekly(t.id)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-semibold">Save</button>
                                        <button onClick={() => setEditingWId(null)} className="text-gray-400 px-3 py-2 text-xs font-semibold">Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <p className="font-medium text-gray-800 dark:text-gray-100">{t.subject}</p>
                                        {t.chapter && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.chapter}</p>}
                                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{new Date(t.weekDate).toLocaleDateString()}</p>
                                      </div>
                                      <div className="text-right flex flex-col items-end">
                                        <p className="font-semibold text-gray-700 dark:text-gray-200">{t.marks}/{t.maxMarks}</p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t.maxMarks > 0 ? ((t.marks / t.maxMarks) * 100).toFixed(0) : '—'}%</p>
                                        {isStaff && (
                                          isApprovedMonth(new Date(t.weekDate).getMonth() + 1, new Date(t.weekDate).getFullYear()) && isTeacher ? (
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                              </svg> Approved
                                            </span>
                                          ) : (
                                            <div className="flex gap-2">
                                              <button onClick={() => { setEditingWId(t.id); setEditWForm({ marks: t.marks.toString(), maxMarks: t.maxMarks.toString(), chapter: t.chapter || '' }); }} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">Edit</button>
                                              <button onClick={() => handleDeleteWeekly(t.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                                <tr>
                                  {['Date', 'Subject', 'Chapter', 'Score', '%'].map(h => (
                                    <th key={h} className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">{h}</th>
                                  ))}
                                  {isTeacher && <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Actions</th>}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {filteredWeeklyTheory.map((t) => {
                                  const isEditing = editingWId === t.id;
                                  return (
                                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{new Date(t.weekDate).toLocaleDateString()}</td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{t.subject}</td>
                                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                                        {isEditing ? (
                                          <input value={editWForm.chapter} onChange={e => setEditWForm({ ...editWForm, chapter: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-28 text-sm" placeholder="Chapter" />
                                        ) : t.chapter || '—'}
                                      </td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {isEditing ? (
                                          <div className="flex items-center gap-1">
                                            <input type="number" value={editWForm.marks} onChange={e => setEditWForm({ ...editWForm, marks: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-16 text-sm" />
                                            <span>/</span>
                                            <input type="number" value={editWForm.maxMarks} onChange={e => setEditWForm({ ...editWForm, maxMarks: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-16 text-sm" />
                                          </div>
                                        ) : `${t.marks}/${t.maxMarks}`}
                                      </td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {isEditing ? '—' : `${t.maxMarks > 0 ? ((t.marks / t.maxMarks) * 100).toFixed(0) : '—'}%`}
                                      </td>
                                      {isTeacher && (
                                        <td className="px-4 py-3 text-right">
                                          {isEditing ? (
                                            <div className="flex gap-2 justify-end">
                                              <button onClick={() => handleUpdateWeekly(t.id)} className="text-emerald-600 dark:text-emerald-400 hover:underline text-xs font-semibold">Save</button>
                                              <button onClick={() => setEditingWId(null)} className="text-gray-400 hover:text-gray-600 text-xs font-semibold">Cancel</button>
                                            </div>
                                          ) : (
                                            isApprovedMonth(new Date(t.weekDate).getMonth() + 1, new Date(t.weekDate).getFullYear()) && isTeacher ? (
                                              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center justify-end gap-1">
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                                </svg> Approved
                                              </span>
                                            ) : (
                                              <div className="flex gap-2 justify-end">
                                                <button onClick={() => { setEditingWId(t.id); setEditWForm({ marks: t.marks.toString(), maxMarks: t.maxMarks.toString(), chapter: t.chapter || '' }); }} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">Edit</button>
                                                <button onClick={() => handleDeleteWeekly(t.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                                              </div>
                                            )
                                          )}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* MCQ Section */}
                      {filteredWeeklyMCQ.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            MCQ Tests
                          </h3>
                          <div className="sm:hidden space-y-2">
                            {filteredWeeklyMCQ.map((t) => {
                              const isEditing = editingWId === t.id;
                              return (
                                <div key={t.id} className={cardCls}>
                                  {isEditing ? (
                                    <div className="space-y-3">
                                      <div>
                                        <label className="block text-xs text-gray-400 mb-1">Chapter</label>
                                        <input value={editWForm.chapter} onChange={e => setEditWForm({ ...editWForm, chapter: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                      </div>
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="block text-xs text-gray-400 mb-1">Marks</label>
                                          <input type="number" value={editWForm.marks} onChange={e => setEditWForm({ ...editWForm, marks: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                        </div>
                                        <div>
                                          <label className="block text-xs text-gray-400 mb-1">Max Marks</label>
                                          <input type="number" value={editWForm.maxMarks} onChange={e => setEditWForm({ ...editWForm, maxMarks: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                        </div>
                                      </div>
                                      <div className="flex gap-2 justify-end pt-1">
                                        <button onClick={() => handleUpdateWeekly(t.id)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-semibold">Save</button>
                                        <button onClick={() => setEditingWId(null)} className="text-gray-400 px-3 py-2 text-xs font-semibold">Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <p className="font-medium text-gray-800 dark:text-gray-100">{t.subject}</p>
                                        {t.chapter && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.chapter}</p>}
                                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{new Date(t.weekDate).toLocaleDateString()}</p>
                                      </div>
                                      <div className="text-right flex flex-col items-end">
                                        <p className="font-semibold text-gray-700 dark:text-gray-200">{t.marks}/{t.maxMarks}</p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t.maxMarks > 0 ? ((t.marks / t.maxMarks) * 100).toFixed(0) : '—'}%</p>
                                        {isStaff && (
                                          isApprovedMonth(new Date(t.weekDate).getMonth() + 1, new Date(t.weekDate).getFullYear()) && isTeacher ? (
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                              </svg> Approved
                                            </span>
                                          ) : (
                                            <div className="flex gap-2">
                                              <button onClick={() => { setEditingWId(t.id); setEditWForm({ marks: t.marks.toString(), maxMarks: t.maxMarks.toString(), chapter: t.chapter || '' }); }} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">Edit</button>
                                              <button onClick={() => handleDeleteWeekly(t.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                                <tr>
                                  {['Date', 'Subject', 'Chapter', 'Score', '%'].map(h => (
                                    <th key={h} className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">{h}</th>
                                  ))}
                                  {isTeacher && <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Actions</th>}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {filteredWeeklyMCQ.map((t) => {
                                  const isEditing = editingWId === t.id;
                                  return (
                                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{new Date(t.weekDate).toLocaleDateString()}</td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{t.subject}</td>
                                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                                        {isEditing ? (
                                          <input value={editWForm.chapter} onChange={e => setEditWForm({ ...editWForm, chapter: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-28 text-sm" placeholder="Chapter" />
                                        ) : t.chapter || '—'}
                                      </td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {isEditing ? (
                                          <div className="flex items-center gap-1">
                                            <input type="number" value={editWForm.marks} onChange={e => setEditWForm({ ...editWForm, marks: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-16 text-sm" />
                                            <span>/</span>
                                            <input type="number" value={editWForm.maxMarks} onChange={e => setEditWForm({ ...editWForm, maxMarks: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-16 text-sm" />
                                          </div>
                                        ) : `${t.marks}/${t.maxMarks}`}
                                      </td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {isEditing ? '—' : `${t.maxMarks > 0 ? ((t.marks / t.maxMarks) * 100).toFixed(0) : '—'}%`}
                                      </td>
                                      {isTeacher && (
                                        <td className="px-4 py-3 text-right">
                                          {isEditing ? (
                                            <div className="flex gap-2 justify-end">
                                              <button onClick={() => handleUpdateWeekly(t.id)} className="text-emerald-600 dark:text-emerald-400 hover:underline text-xs font-semibold">Save</button>
                                              <button onClick={() => setEditingWId(null)} className="text-gray-400 hover:text-gray-600 text-xs font-semibold">Cancel</button>
                                            </div>
                                          ) : (
                                            isApprovedMonth(new Date(t.weekDate).getMonth() + 1, new Date(t.weekDate).getFullYear()) && isTeacher ? (
                                              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center justify-end gap-1">
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                                </svg> Approved
                                              </span>
                                            ) : (
                                              <div className="flex gap-2 justify-end">
                                                <button onClick={() => { setEditingWId(t.id); setEditWForm({ marks: t.marks.toString(), maxMarks: t.maxMarks.toString(), chapter: t.chapter || '' }); }} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">Edit</button>
                                                <button onClick={() => handleDeleteWeekly(t.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                                              </div>
                                            )
                                          )}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }
              </div>
            )}
          </div>
        )}

        {/* Monthly Tests Tab */}
        {tab === 'monthly' && (
          <div>
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <div className="flex flex-wrap gap-2 items-center">
                <select value={mFilter.month} onChange={(e) => setMFilter({ ...mFilter, month: e.target.value })}
                  className={filterSelectCls}>
                  <option value="">All months</option>
                  {MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                </select>
                <input type="number" placeholder="Year" value={mFilter.year}
                  onChange={(e) => setMFilter({ ...mFilter, year: e.target.value })}
                  className={`${filterSelectCls} w-24`} />
                {(mFilter.month || mFilter.year) && (
                  <button onClick={() => setMFilter({ month: '', year: '' })} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-2">Clear</button>
                )}
              </div>
              {isTeacher && (
                <button onClick={() => setShowMForm(!showMForm)}
                  className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium">
                  {showMForm ? 'Cancel' : '+ Add Monthly Test'}
                </button>
              )}
            </div>

            {isTeacher && showMForm && (
              <form onSubmit={handleAddMonthly} className={`${cardCls} mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3`}>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Month (1–12)</label>
                  <input type="number" required value={mForm.month} onChange={(e) => setMForm({ ...mForm, month: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Year</label>
                  <input type="number" required value={mForm.year} onChange={(e) => setMForm({ ...mForm, year: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Test Type</label>
                  <select required value={mForm.testType} onChange={(e) => setMForm({ ...mForm, testType: e.target.value })} className={inputCls}>
                    <option value="Theory">Theory</option>
                    <option value="MCQ">MCQ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Subject</label>
                  <select required value={mForm.subject} onChange={(e) => setMForm({ ...mForm, subject: e.target.value })} className={inputCls}>
                    <option value="Physics">Physics</option>
                    <option value="Chemistry">Chemistry</option>
                    <option value="Math">Math</option>
                    <option value="Biology">Biology</option>
                    <option value="Language 1">Language 1</option>
                    <option value="Language 2">Language 2</option>
                    <option value="Psychology">Psychology</option>
                    {mForm.testType === 'MCQ' && <option value="General MCQ">General MCQ</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Marks</label>
                  <input type="number" required value={mForm.marks} onChange={(e) => setMForm({ ...mForm, marks: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Max Marks</label>
                  <input type="number" required value={mForm.maxMarks} onChange={(e) => setMForm({ ...mForm, maxMarks: e.target.value })} className={inputCls} />
                </div>
                {mForm.month && mForm.year && isApprovedMonth(Number(mForm.month), Number(mForm.year)) && isTeacher && (
                  <div className="col-span-full text-xs text-red-700 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-900/20 px-3 py-2.5 rounded-xl flex items-center gap-1.5 border border-red-150 dark:border-red-900/40">
                    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    This month has been approved by admin and is locked. You cannot add tests for this month.
                  </div>
                )}
                <div className="col-span-full">
                  <button type="submit" disabled={mSaving || (mForm.month && mForm.year ? isApprovedMonth(Number(mForm.month), Number(mForm.year)) && isTeacher : false)}
                    className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                    {mSaving ? 'Saving…' : 'Add'}
                  </button>
                </div>
              </form>
            )}

            {testLoading ? <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p> : monthly.length === 0 ? (
              <EmptyState title="No monthly tests yet" description="Click '+ Add Monthly Test' to add the first result." icon="chart" />
            ) : (
              <div>
                {user?.role === 'ADMIN' && filteredMonthly.length > 0 && (
                  <div className="flex justify-end gap-2 mb-2">
                    <button onClick={() => exportMonthlyExcel(filteredMonthly, `${studentName}${filterLabel(mFilter.month, mFilter.year) ? '_' + filterLabel(mFilter.month, mFilter.year) : ''}`)}
                      className={exportBtnCls}>↓ Excel</button>
                    <button onClick={() => exportMonthlyPDF(filteredMonthly, `${studentName}${filterLabel(mFilter.month, mFilter.year) ? '_' + filterLabel(mFilter.month, mFilter.year) : ''}`)}
                      className={exportBtnCls}>↓ PDF</button>
                  </div>
                )}
                {filteredMonthly.length === 0
                  ? <p className="text-sm text-gray-400 dark:text-gray-500">No tests match the selected filter.</p>
                  : (
                    <div className="space-y-8">
                      {/* Theory Section */}
                      {filteredMonthlyTheory.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500" />
                            Theory Tests
                          </h3>
                          <div className="sm:hidden space-y-2">
                            {filteredMonthlyTheory.map((t) => {
                              const isEditing = editingMId === t.id;
                              return (
                                <div key={t.id} className={cardCls}>
                                  {isEditing ? (
                                    <div className="space-y-3">
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="block text-xs text-gray-400 mb-1">Marks</label>
                                          <input type="number" value={editMForm.marks} onChange={e => setEditMForm({ ...editMForm, marks: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                        </div>
                                        <div>
                                          <label className="block text-xs text-gray-400 mb-1">Max Marks</label>
                                          <input type="number" value={editMForm.maxMarks} onChange={e => setEditMForm({ ...editMForm, maxMarks: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                        </div>
                                      </div>
                                      <div className="flex gap-2 justify-end pt-1">
                                        <button onClick={() => handleUpdateMonthly(t.id)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-semibold">Save</button>
                                        <button onClick={() => setEditingMId(null)} className="text-gray-400 px-3 py-2 text-xs font-semibold">Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <p className="font-medium text-gray-800 dark:text-gray-100">{t.subject}</p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{MONTHS[t.month]} {t.year}</p>
                                      </div>
                                      <div className="text-right flex flex-col items-end">
                                        <p className="font-semibold text-gray-700 dark:text-gray-200">{t.marks}/{t.maxMarks}</p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t.maxMarks > 0 ? ((t.marks / t.maxMarks) * 100).toFixed(0) : '—'}%</p>
                                        {isStaff && (
                                          isApprovedMonth(t.month, t.year) && isTeacher ? (
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                              </svg> Approved
                                            </span>
                                          ) : (
                                            <div className="flex gap-2">
                                              <button onClick={() => { setEditingMId(t.id); setEditMForm({ marks: t.marks.toString(), maxMarks: t.maxMarks.toString() }); }} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">Edit</button>
                                              <button onClick={() => handleDeleteMonthly(t.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                                <tr>
                                  {['Period', 'Subject', 'Score', '%'].map(h => (
                                    <th key={h} className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">{h}</th>
                                  ))}
                                  {isTeacher && <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Actions</th>}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {filteredMonthlyTheory.map((t) => {
                                  const isEditing = editingMId === t.id;
                                  return (
                                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{MONTHS[t.month]} {t.year}</td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{t.subject}</td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {isEditing ? (
                                          <div className="flex items-center gap-1">
                                            <input type="number" value={editMForm.marks} onChange={e => setEditMForm({ ...editMForm, marks: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-16 text-sm" />
                                            <span>/</span>
                                            <input type="number" value={editMForm.maxMarks} onChange={e => setEditMForm({ ...editMForm, maxMarks: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-16 text-sm" />
                                          </div>
                                        ) : `${t.marks}/${t.maxMarks}`}
                                      </td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {isEditing ? '—' : `${t.maxMarks > 0 ? ((t.marks / t.maxMarks) * 100).toFixed(0) : '—'}%`}
                                      </td>
                                      {isTeacher && (
                                        <td className="px-4 py-3 text-right">
                                          {isEditing ? (
                                            <div className="flex gap-2 justify-end">
                                              <button onClick={() => handleUpdateMonthly(t.id)} className="text-emerald-600 dark:text-emerald-400 hover:underline text-xs font-semibold">Save</button>
                                              <button onClick={() => setEditingMId(null)} className="text-gray-400 hover:text-gray-600 text-xs font-semibold">Cancel</button>
                                            </div>
                                          ) : (
                                            isApprovedMonth(t.month, t.year) && isTeacher ? (
                                              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center justify-end gap-1">
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                                </svg> Approved
                                              </span>
                                            ) : (
                                              <div className="flex gap-2 justify-end">
                                                <button onClick={() => { setEditingMId(t.id); setEditMForm({ marks: t.marks.toString(), maxMarks: t.maxMarks.toString() }); }} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">Edit</button>
                                                <button onClick={() => handleDeleteMonthly(t.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                                              </div>
                                            )
                                          )}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* MCQ Section */}
                      {filteredMonthlyMCQ.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            MCQ Tests
                          </h3>
                          <div className="sm:hidden space-y-2">
                            {filteredMonthlyMCQ.map((t) => {
                              const isEditing = editingMId === t.id;
                              return (
                                <div key={t.id} className={cardCls}>
                                  {isEditing ? (
                                    <div className="space-y-3">
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="block text-xs text-gray-400 mb-1">Marks</label>
                                          <input type="number" value={editMForm.marks} onChange={e => setEditMForm({ ...editMForm, marks: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                        </div>
                                        <div>
                                          <label className="block text-xs text-gray-400 mb-1">Max Marks</label>
                                          <input type="number" value={editMForm.maxMarks} onChange={e => setEditMForm({ ...editMForm, maxMarks: e.target.value })} className="w-full border dark:border-gray-600 dark:bg-gray-700 px-3 py-2 rounded-xl text-sm" />
                                        </div>
                                      </div>
                                      <div className="flex gap-2 justify-end pt-1">
                                        <button onClick={() => handleUpdateMonthly(t.id)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-semibold">Save</button>
                                        <button onClick={() => setEditingMId(null)} className="text-gray-400 px-3 py-2 text-xs font-semibold">Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <p className="font-medium text-gray-800 dark:text-gray-100">{t.subject}</p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{MONTHS[t.month]} {t.year}</p>
                                      </div>
                                      <div className="text-right flex flex-col items-end">
                                        <p className="font-semibold text-gray-700 dark:text-gray-200">{t.marks}/{t.maxMarks}</p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t.maxMarks > 0 ? ((t.marks / t.maxMarks) * 100).toFixed(0) : '—'}%</p>
                                        {isStaff && (
                                          isApprovedMonth(t.month, t.year) && isTeacher ? (
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                              </svg> Approved
                                            </span>
                                          ) : (
                                            <div className="flex gap-2">
                                              <button onClick={() => { setEditingMId(t.id); setEditMForm({ marks: t.marks.toString(), maxMarks: t.maxMarks.toString() }); }} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">Edit</button>
                                              <button onClick={() => handleDeleteMonthly(t.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                                <tr>
                                  {['Period', 'Subject', 'Score', '%'].map(h => (
                                    <th key={h} className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">{h}</th>
                                  ))}
                                  {isTeacher && <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Actions</th>}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {filteredMonthlyMCQ.map((t) => {
                                  const isEditing = editingMId === t.id;
                                  return (
                                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{MONTHS[t.month]} {t.year}</td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{t.subject}</td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {isEditing ? (
                                          <div className="flex items-center gap-1">
                                            <input type="number" value={editMForm.marks} onChange={e => setEditMForm({ ...editMForm, marks: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-16 text-sm" />
                                            <span>/</span>
                                            <input type="number" value={editMForm.maxMarks} onChange={e => setEditMForm({ ...editMForm, maxMarks: e.target.value })} className="border dark:border-gray-600 dark:bg-gray-700 px-2 py-1 rounded w-16 text-sm" />
                                          </div>
                                        ) : `${t.marks}/${t.maxMarks}`}
                                      </td>
                                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                        {isEditing ? '—' : `${t.maxMarks > 0 ? ((t.marks / t.maxMarks) * 100).toFixed(0) : '—'}%`}
                                      </td>
                                      {isTeacher && (
                                        <td className="px-4 py-3 text-right">
                                          {isEditing ? (
                                            <div className="flex gap-2 justify-end">
                                              <button onClick={() => handleUpdateMonthly(t.id)} className="text-emerald-600 dark:text-emerald-400 hover:underline text-xs font-semibold">Save</button>
                                              <button onClick={() => setEditingMId(null)} className="text-gray-400 hover:text-gray-600 text-xs font-semibold">Cancel</button>
                                            </div>
                                          ) : (
                                            isApprovedMonth(t.month, t.year) && isTeacher ? (
                                              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center justify-end gap-1">
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                                </svg> Approved
                                              </span>
                                            ) : (
                                              <div className="flex gap-2 justify-end">
                                                <button onClick={() => { setEditingMId(t.id); setEditMForm({ marks: t.marks.toString(), maxMarks: t.maxMarks.toString() }); }} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">Edit</button>
                                                <button onClick={() => handleDeleteMonthly(t.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                                              </div>
                                            )
                                          )}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }
              </div>
            )}
          </div>
        )}

        {/* Remarks Tab */}
        {tab === 'remarks' && (
          <div>
            {isTeacher && (
              <div className="flex justify-end mb-3">
                <button onClick={() => setShowRForm(!showRForm)}
                  className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium">
                  {showRForm ? 'Cancel' : '+ Add Remark'}
                </button>
              </div>
            )}
            {isTeacher && showRForm && (
              <form onSubmit={handleAddRemark} className={`${cardCls} mb-4 space-y-3`}>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Category</label>
                  <input required value={rForm.category} onChange={(e) => setRForm({ ...rForm, category: e.target.value })}
                    placeholder="e.g. Behaviour, Academic, Attendance" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">Text</label>
                  <textarea required rows={3} value={rForm.text} onChange={(e) => setRForm({ ...rForm, text: e.target.value })}
                    className={`${inputCls} resize-none`} />
                </div>
                <label className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded" checked={rForm.isFlagged} onChange={(e) => setRForm({ ...rForm, isFlagged: e.target.checked })} />
                  Flag for Admin attention
                </label>
                <button type="submit" disabled={rSaving}
                  className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                  {rSaving ? 'Saving…' : 'Add Remark'}
                </button>
              </form>
            )}

            {remarkLoading ? <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p> : remarks.length === 0 ? (
              <EmptyState title="No remarks yet" description={isStaff ? "Click '+ Add Remark' to add the first one." : "No remarks have been added for this student."} icon="clipboard" />
            ) : (
              <div className="space-y-3">
                {remarks.map((r) => (
                  <div key={r.id} className={`bg-white dark:bg-gray-800 border rounded-2xl p-4 ${r.isFlagged ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full font-medium">{r.category}</span>
                        {r.isFlagged && <span className="text-xs bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-2.5 py-1 rounded-full font-medium">Flagged</span>}
                      </div>
                      {isTeacher && (
                        <button
                          onClick={() => flag(r.id).then(() => fetchRemarks())}
                          className={`text-sm px-2 py-1 rounded-lg transition-colors ${r.isFlagged ? 'text-red-400 hover:text-gray-500 dark:hover:text-gray-400' : 'text-gray-400 hover:text-red-500 dark:hover:text-red-400'}`}
                        >
                          {r.isFlagged ? 'Unflag' : 'Flag'}
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{r.text}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">{r.teacher?.name} &middot; {new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
