import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useStaff, Staff as StaffMember, StaffRole } from '../../hooks/useStaff';
import { useBatches } from '../../hooks/useBatches';
import { useCampuses } from '../../hooks/useCampuses';
import Layout from '../../components/Layout';
import ConfirmModal from '../../components/ConfirmModal';
import EmptyState from '../../components/EmptyState';

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
const checkCls = 'w-4 h-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-indigo-600 focus:ring-indigo-500';

interface FormState {
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  batchIds: string[];
  libraryAccess: boolean;
  libraryCampusId: string;
}

const emptyForm: FormState = { name: '', email: '', password: '', role: 'TEACHER', batchIds: [], libraryAccess: false, libraryCampusId: '' };

type Filter = 'ALL' | StaffRole;

function RolePill({ role }: { role: StaffRole }) {
  return role === 'LIBRARIAN' ? (
    <span className="text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full font-medium">Librarian</span>
  ) : (
    <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">Teacher</span>
  );
}

export default function Staff() {
  const { staff, loading, fetchStaff, createStaff, updateStaff } = useStaff();
  const { batches, fetch: fetchBatches } = useBatches();
  const { campuses, fetchCampuses } = useCampuses();

  const [filter, setFilter] = useState<Filter>('ALL');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState<FormState>(emptyForm);
  const [saving, setSaving]     = useState(false);

  const [editId, setEditId]       = useState<string | null>(null);
  const [editOrig, setEditOrig]   = useState<StaffMember | null>(null);
  const [editForm, setEditForm]   = useState<FormState>(emptyForm);
  const [editSaving, setEditSaving] = useState(false);
  const [roleConfirm, setRoleConfirm] = useState(false);

  const [resetId, setResetId]     = useState<string | null>(null);
  const [resetPw, setResetPw]     = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<{ id: string; active: boolean; role: StaffRole } | null>(null);
  const [deactivateSaving, setDeactivateSaving] = useState(false);

  useEffect(() => {
    fetchStaff().catch(() => {});
    fetchBatches().catch(() => {});
    fetchCampuses().catch(() => {});
  }, [fetchStaff, fetchBatches, fetchCampuses]);

  const activeCampuses = campuses.filter((c) => c.isActive);
  const visible = filter === 'ALL' ? staff : staff.filter((s) => s.role === filter);

  function campusOptions(currentId: string) {
    const list = [...activeCampuses];
    const cur = campuses.find((c) => c.id === currentId);
    if (cur && !cur.isActive) list.push(cur);
    return list.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>);
  }

  function toggleBatch(f: FormState, set: (v: FormState) => void, id: string) {
    set({ ...f, batchIds: f.batchIds.includes(id) ? f.batchIds.filter((b) => b !== id) : [...f.batchIds, id] });
  }

  function openEdit(s: StaffMember) {
    setEditId(s.id);
    setEditOrig(s);
    setEditForm({
      name: s.name, email: s.email, password: '', role: s.role,
      batchIds: [...s.batchIds], libraryAccess: !!s.libraryCampusId, libraryCampusId: s.libraryCampusId ?? '',
    });
    setShowForm(false);
  }

  function cancelEdit() { setEditId(null); setEditOrig(null); setRoleConfirm(false); }

  /** Returns an error message, or null when the form is valid. */
  function validate(f: FormState): string | null {
    if (f.role === 'LIBRARIAN' && !f.libraryCampusId) return 'Please choose a campus for the librarian';
    if (f.role === 'TEACHER' && f.libraryAccess && !f.libraryCampusId) return 'Please choose a campus for library access';
    return null;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      await createStaff({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        ...(form.role === 'TEACHER' ? { batchIds: form.batchIds } : {}),
        ...(form.role === 'LIBRARIAN' || form.libraryAccess ? { libraryCampusId: form.libraryCampusId } : {}),
      });
      setForm(emptyForm);
      setShowForm(false);
      fetchStaff().catch(() => {});
      toast.success(form.role === 'LIBRARIAN' ? 'Librarian created' : 'Teacher created');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to create staff member');
    } finally { setSaving(false); }
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(editForm);
    if (err) { toast.error(err); return; }
    if (editOrig && editOrig.role === 'TEACHER' && editForm.role === 'LIBRARIAN' && editOrig.batchIds.length > 0) {
      setRoleConfirm(true);
      return;
    }
    doEdit();
  }

  async function doEdit() {
    if (!editId) return;
    setEditSaving(true);
    try {
      await updateStaff(editId, {
        name: editForm.name,
        role: editForm.role,
        ...(editForm.role === 'TEACHER' ? { batchIds: editForm.batchIds } : {}),
        libraryCampusId: editForm.role === 'LIBRARIAN' || editForm.libraryAccess ? editForm.libraryCampusId : null,
      });
      cancelEdit();
      fetchStaff().catch(() => {});
      toast.success('Staff member updated');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update staff member');
    } finally { setEditSaving(false); setRoleConfirm(false); }
  }

  async function handleResetPassword() {
    if (!resetId || !resetPw) return;
    setResetSaving(true);
    try {
      await updateStaff(resetId, { password: resetPw });
      setResetId(null); setResetPw('');
      toast.success('Password reset successfully');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to reset password');
    } finally { setResetSaving(false); }
  }

  async function handleToggleActive() {
    if (!deactivateTarget) return;
    setDeactivateSaving(true);
    try {
      await updateStaff(deactivateTarget.id, { isActive: !deactivateTarget.active });
      fetchStaff().catch(() => {});
      toast.success(deactivateTarget.active ? 'Account deactivated' : 'Account activated');
      setDeactivateTarget(null);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update status');
    } finally { setDeactivateSaving(false); }
  }

  function renderRoleFields(f: FormState, set: (v: FormState) => void, currentCampusId: string) {
    return (
      <>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Role</label>
          <select value={f.role} onChange={(e) => set({ ...f, role: e.target.value as StaffRole })} className={inputCls}>
            <option value="TEACHER">Teacher</option>
            <option value="LIBRARIAN">Librarian</option>
          </select>
        </div>

        {f.role === 'TEACHER' ? (
          <>
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 font-medium">Assign Batches</p>
              <div className="flex flex-wrap gap-3">
                {batches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" className={checkCls} checked={f.batchIds.includes(b.id)} onChange={() => toggleBatch(f, set, b.id)} />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300 font-medium">
                <input type="checkbox" className={checkCls} checked={f.libraryAccess}
                  onChange={(e) => set({ ...f, libraryAccess: e.target.checked })} />
                Library access
              </label>
              {f.libraryAccess && (
                <div className="mt-2">
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Library campus</label>
                  <select value={f.libraryCampusId} onChange={(e) => set({ ...f, libraryCampusId: e.target.value })} className={inputCls}>
                    <option value="">Select campus…</option>
                    {campusOptions(currentCampusId)}
                  </select>
                </div>
              )}
            </div>
          </>
        ) : (
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Campus</label>
            <select required value={f.libraryCampusId} onChange={(e) => set({ ...f, libraryCampusId: e.target.value })} className={inputCls}>
              <option value="">Select campus…</option>
              {campusOptions(currentCampusId)}
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">Librarians only see the Library section for this campus.</p>
          </div>
        )}
      </>
    );
  }

  function renderBatchesCell(s: StaffMember, empty: string) {
    if (s.role === 'LIBRARIAN') return '—';
    return batches.filter((b) => s.batchIds.includes(b.id)).map((b) => b.name).join(', ') || empty;
  }

  function statusPill(active: boolean) {
    return (
      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${active ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
        {active ? 'Active' : 'Inactive'}
      </span>
    );
  }

  const tabs: { key: Filter; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'TEACHER', label: 'Teachers' },
    { key: 'LIBRARIAN', label: 'Librarians' },
  ];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Staff</h2>
          <button
            onClick={() => { setShowForm(!showForm); cancelEdit(); }}
            className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium"
          >
            {showForm ? 'Cancel' : '+ New Staff'}
          </button>
        </div>

        <div className="flex gap-2 mb-4" role="tablist" aria-label="Filter by role">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={filter === t.key}
              onClick={() => setFilter(t.key)}
              className={`text-sm px-3.5 py-1.5 rounded-full font-medium transition-colors ${
                filter === t.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 mb-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">New Staff Member</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { label: 'Name', key: 'name', type: 'text' },
                { label: 'Username / Email', key: 'email', type: 'text' },
                { label: 'Password', key: 'password', type: 'password' },
              ] as const).map((f) => (
                <div key={f.key} className={f.key === 'name' ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">{f.label}</label>
                  <input type={f.type} required value={form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className={inputCls} />
                </div>
              ))}
            </div>
            {renderRoleFields(form, setForm, '')}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                {saving ? 'Saving…' : form.role === 'LIBRARIAN' ? 'Create Librarian' : 'Create Teacher'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-2.5">Cancel</button>
            </div>
          </form>
        )}

        {editId && (
          <form onSubmit={handleEditSubmit} className="bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700 rounded-2xl p-5 mb-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Edit Staff Member</p>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Name</label>
              <input required value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className={inputCls} />
            </div>
            {renderRoleFields(editForm, setEditForm, editOrig?.libraryCampusId ?? '')}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={editSaving}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
              <button type="button" onClick={cancelEdit}
                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-2.5">Cancel</button>
            </div>
          </form>
        )}

        {/* Reset Password modal */}
        {resetId && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => { setResetId(null); setResetPw(''); }} aria-hidden="true" />
            <form
              role="dialog"
              aria-modal="true"
              aria-labelledby="reset-pw-title"
              onSubmit={(e) => { e.preventDefault(); handleResetPassword(); }}
              className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4"
            >
              <h3 id="reset-pw-title" className="text-base font-semibold text-gray-800 dark:text-gray-100">Reset Password</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Enter a new password for this staff member.</p>
              <div>
                <label htmlFor="reset-pw-input" className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">New Password</label>
                <input
                  id="reset-pw-input" type="password" value={resetPw} autoFocus autoComplete="new-password"
                  onChange={(e) => setResetPw(e.target.value)}
                  placeholder="Min 8 characters"
                  className={inputCls}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={resetSaving || resetPw.length < 8}
                  className="flex-1 py-2.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl font-medium disabled:opacity-60"
                >
                  {resetSaving ? 'Resetting…' : 'Reset Password'}
                </button>
                <button type="button" onClick={() => { setResetId(null); setResetPw(''); }}
                  className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-xl">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <ConfirmModal
          open={!!deactivateTarget}
          title={deactivateTarget?.active ? 'Deactivate Account' : 'Activate Account'}
          message={deactivateTarget?.active
            ? 'This person will lose access to the system. You can reactivate them later.'
            : 'This person will regain access to the system.'}
          confirmLabel={deactivateTarget?.active ? 'Deactivate' : 'Activate'}
          danger={deactivateTarget?.active}
          loading={deactivateSaving}
          onConfirm={handleToggleActive}
          onCancel={() => setDeactivateTarget(null)}
        />

        <ConfirmModal
          open={roleConfirm}
          title="Change to Librarian"
          message="This teacher's batch assignments will be removed when they become a librarian. Continue?"
          confirmLabel="Change role"
          danger
          loading={editSaving}
          onConfirm={doEdit}
          onCancel={() => setRoleConfirm(false)}
        />

        {loading ? <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p> : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {visible.length === 0 ? (
              <EmptyState
                title={filter === 'LIBRARIAN' ? 'No librarians yet' : filter === 'TEACHER' ? 'No teachers yet' : 'No staff yet'}
                description="Create an account to get started."
                icon="user"
              />
            ) : (
              <>
                {/* Mobile card list */}
                <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                  {visible.map((s) => (
                    <div key={s.id} className={`px-4 py-4 ${editId === s.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''} ${s.isActive === false ? 'opacity-50' : ''}`}>
                      <div className="flex items-start justify-between mb-2 gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-800 dark:text-gray-100">{s.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-all">{s.email}</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            <RolePill role={s.role} />
                            {s.libraryCampus && (
                              <span className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">
                                Library: {s.libraryCampus.name}
                              </span>
                            )}
                          </div>
                          {s.role === 'TEACHER' && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{renderBatchesCell(s, 'No batches')}</p>
                          )}
                        </div>
                        <span className="flex-shrink-0">{statusPill(s.isActive !== false)}</span>
                      </div>
                      <div className="flex gap-4 mt-1">
                        <button
                          onClick={() => editId === s.id ? cancelEdit() : openEdit(s)}
                          className="text-sm text-indigo-600 dark:text-indigo-400 font-medium"
                        >
                          {editId === s.id ? 'Cancel edit' : 'Edit'}
                        </button>
                        <button
                          onClick={() => { setResetId(s.id); setResetPw(''); }}
                          className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          Reset PW
                        </button>
                        <button
                          onClick={() => setDeactivateTarget({ id: s.id, active: s.isActive !== false, role: s.role })}
                          className="text-sm text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          {s.isActive !== false ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Name</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Username / Email</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Role</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Batches</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Library</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {visible.map((s) => (
                        <tr key={s.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${editId === s.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''} ${s.isActive === false ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{s.name}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{s.email}</td>
                          <td className="px-4 py-3"><RolePill role={s.role} /></td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{renderBatchesCell(s, '—')}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                            {s.libraryCampus ? `Library: ${s.libraryCampus.name}` : '—'}
                          </td>
                          <td className="px-4 py-3">{statusPill(s.isActive !== false)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="flex gap-3 justify-end">
                              <button
                                onClick={() => editId === s.id ? cancelEdit() : openEdit(s)}
                                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                              >
                                {editId === s.id ? 'Cancel' : 'Edit'}
                              </button>
                              <button
                                onClick={() => { setResetId(s.id); setResetPw(''); }}
                                className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                              >
                                Reset PW
                              </button>
                              <button
                                onClick={() => setDeactivateTarget({ id: s.id, active: s.isActive !== false, role: s.role })}
                                className="text-sm text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                              >
                                {s.isActive !== false ? 'Deactivate' : 'Activate'}
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))}
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
