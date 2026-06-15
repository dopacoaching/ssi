import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAdmin } from '../../hooks/useAdmin';
import { useBatches } from '../../hooks/useBatches';
import Layout from '../../components/Layout';
import ConfirmModal from '../../components/ConfirmModal';
import EmptyState from '../../components/EmptyState';

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';

export default function Teachers() {
  const { teachers, loading, fetchTeachers, createTeacher, updateTeacher } = useAdmin();
  const { batches, fetch: fetchBatches } = useBatches();

  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState({ email: '', password: '', name: '', batchIds: [] as string[] });
  const [saving, setSaving]       = useState(false);

  const [editId, setEditId]       = useState<string | null>(null);
  const [editForm, setEditForm]   = useState({ name: '', batchIds: [] as string[] });
  const [editSaving, setEditSaving] = useState(false);

  const [resetId, setResetId]     = useState<string | null>(null);
  const [resetPw, setResetPw]     = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<{ id: string; active: boolean } | null>(null);
  const [deactivateSaving, setDeactivateSaving] = useState(false);

  useEffect(() => { fetchTeachers().catch(() => {}); fetchBatches().catch(() => {}); }, [fetchTeachers, fetchBatches]);

  function toggleBatch(id: string) {
    setForm((f) => ({
      ...f,
      batchIds: f.batchIds.includes(id) ? f.batchIds.filter((b) => b !== id) : [...f.batchIds, id],
    }));
  }

  function toggleEditBatch(id: string) {
    setEditForm((f) => ({
      ...f,
      batchIds: f.batchIds.includes(id) ? f.batchIds.filter((b) => b !== id) : [...f.batchIds, id],
    }));
  }

  function openEdit(t: { id: string; name: string; batchIds: string[] }) {
    setEditId(t.id);
    setEditForm({ name: t.name, batchIds: [...t.batchIds] });
    setShowForm(false);
  }

  function cancelEdit() { setEditId(null); }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    try {
      await createTeacher(form);
      setForm({ email: '', password: '', name: '', batchIds: [] });
      setShowForm(false);
      fetchTeachers().catch(() => {});
      toast.success('Teacher created');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to create teacher');
    } finally { setSaving(false); }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    try {
      await updateTeacher(editId, { name: editForm.name, batchIds: editForm.batchIds });
      setEditId(null);
      fetchTeachers().catch(() => {});
      toast.success('Teacher updated');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update teacher');
    } finally { setEditSaving(false); }
  }

  async function handleResetPassword() {
    if (!resetId || !resetPw) return;
    setResetSaving(true);
    try {
      await updateTeacher(resetId, { password: resetPw });
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
      await updateTeacher(deactivateTarget.id, { isActive: !deactivateTarget.active });
      fetchTeachers().catch(() => {});
      toast.success(deactivateTarget.active ? 'Teacher deactivated' : 'Teacher activated');
      setDeactivateTarget(null);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update status');
    } finally { setDeactivateSaving(false); }
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Teachers</h2>
          <button
            onClick={() => { setShowForm(!showForm); cancelEdit(); }}
            className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium"
          >
            {showForm ? 'Cancel' : '+ New Teacher'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 mb-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">New Teacher</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { label: 'Name', key: 'name', type: 'text' },
                { label: 'Username / Email', key: 'email', type: 'text' },
                { label: 'Password', key: 'password', type: 'password' },
              ] as const).map((f) => (
                <div key={f.key} className={f.key === 'name' ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">{f.label}</label>
                  <input type={f.type} required value={(form as any)[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className={inputCls} />
                </div>
              ))}
            </div>
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 font-medium">Assign Batches</p>
              <div className="flex flex-wrap gap-3">
                {batches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-indigo-600 focus:ring-indigo-500" checked={form.batchIds.includes(b.id)} onChange={() => toggleBatch(b.id)} />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Create Teacher'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-2.5">Cancel</button>
            </div>
          </form>
        )}

        {editId && (
          <form onSubmit={handleEdit} className="bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700 rounded-2xl p-5 mb-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Edit Teacher</p>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Name</label>
              <input required value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 font-medium">Assigned Batches</p>
              <div className="flex flex-wrap gap-3">
                {batches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-indigo-600 focus:ring-indigo-500" checked={editForm.batchIds.includes(b.id)} onChange={() => toggleEditBatch(b.id)} />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
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
              <p className="text-sm text-gray-500 dark:text-gray-400">Enter a new password for this teacher.</p>
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
          title={deactivateTarget?.active ? 'Deactivate Teacher' : 'Activate Teacher'}
          message={deactivateTarget?.active
            ? 'This teacher will lose access to the system. You can reactivate them later.'
            : 'This teacher will regain access to the system.'}
          confirmLabel={deactivateTarget?.active ? 'Deactivate' : 'Activate'}
          danger={deactivateTarget?.active}
          loading={deactivateSaving}
          onConfirm={handleToggleActive}
          onCancel={() => setDeactivateTarget(null)}
        />

        {loading ? <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p> : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {teachers.length === 0 ? (
              <EmptyState title="No teachers yet" description="Create a teacher account to get started." icon="user" />
            ) : (
              <>
                {/* Mobile card list */}
                <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                  {teachers.map((t) => (
                    <div key={t.id} className={`px-4 py-4 ${editId === t.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''} ${t.isActive === false ? 'opacity-50' : ''}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-gray-800 dark:text-gray-100">{t.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.email}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {batches.filter((b) => t.batchIds.includes(b.id)).map((b) => b.name).join(', ') || 'No batches'}
                          </p>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${t.isActive !== false ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                          {t.isActive !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="flex gap-4 mt-1">
                        <button
                          onClick={() => editId === t.id ? cancelEdit() : openEdit(t)}
                          className="text-sm text-indigo-600 dark:text-indigo-400 font-medium"
                        >
                          {editId === t.id ? 'Cancel edit' : 'Edit'}
                        </button>
                        <button
                          onClick={() => { setResetId(t.id); setResetPw(''); }}
                          className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          Reset PW
                        </button>
                        <button
                          onClick={() => setDeactivateTarget({ id: t.id, active: t.isActive !== false })}
                          className="text-sm text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          {t.isActive !== false ? 'Deactivate' : 'Activate'}
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
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Batches</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {teachers.map((t) => (
                        <tr key={t.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${editId === t.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''} ${t.isActive === false ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{t.name}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{t.email}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                            {batches.filter((b) => t.batchIds.includes(b.id)).map((b) => b.name).join(', ') || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${t.isActive !== false ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                              {t.isActive !== false ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="flex gap-3 justify-end">
                              <button
                                onClick={() => editId === t.id ? cancelEdit() : openEdit(t)}
                                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                              >
                                {editId === t.id ? 'Cancel' : 'Edit'}
                              </button>
                              <button
                                onClick={() => { setResetId(t.id); setResetPw(''); }}
                                className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                              >
                                Reset PW
                              </button>
                              <button
                                onClick={() => setDeactivateTarget({ id: t.id, active: t.isActive !== false })}
                                className="text-sm text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                              >
                                {t.isActive !== false ? 'Deactivate' : 'Activate'}
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
