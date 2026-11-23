import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBatches, Batch } from '../../hooks/useBatches';
import { useCampuses } from '../../hooks/useCampuses';
import { useAdmin } from '../../hooks/useAdmin';
import Layout from '../../components/Layout';
import EmptyState from '../../components/EmptyState';

const inputCls = 'border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
const inlineInputCls = 'border border-indigo-300 dark:border-indigo-500 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400';

export default function Batches() {
  const { batches, loading, fetch, create, update } = useBatches();
  const { teachers, fetchTeachers } = useAdmin();
  const { campuses, fetchCampuses } = useCampuses();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', year: new Date().getFullYear().toString(), campusId: '' });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', year: '', campusId: '' });

  useEffect(() => {
    fetch().catch(() => {});
    fetchTeachers().catch(() => {});
    fetchCampuses().catch(() => {});
  }, [fetch, fetchTeachers, fetchCampuses]);

  const activeCampuses = campuses.filter((c) => c.isActive);

  function campusOptions(currentId: string) {
    // Keep the batch's current campus selectable even if it was deactivated.
    const list = [...activeCampuses];
    const cur = campuses.find((c) => c.id === currentId);
    if (cur && !cur.isActive) list.push(cur);
    return list.map((c) => (
      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
    ));
  }

  function CampusPill({ campus }: { campus: Batch['campus'] }) {
    return campus ? (
      <span className="text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full font-medium">
        {campus.code} &middot; {campus.name}
      </span>
    ) : (
      <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">
        No campus
      </span>
    );
  }

  function startEdit(b: Batch) {
    setEditId(b.id);
    setEditForm({ name: b.name, year: b.year.toString(), campusId: b.campusId ?? '' });
  }

  function teachersForBatch(batchId: string) {
    return teachers.filter((t) => t.batchIds.includes(batchId)).map((t) => t.name);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.campusId) { toast.error('Please choose a campus'); return; }
    setSaving(true);
    try {
      await create(form.name, Number(form.year), form.campusId);
      setForm({ name: '', year: new Date().getFullYear().toString(), campusId: '' });
      setShowForm(false);
      fetch().catch(() => {});
      toast.success('Batch created');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to create batch');
    } finally { setSaving(false); }
  }

  async function handleUpdate(id: string) {
    // Campus is optional on edit so batches created before campuses existed can still be renamed;
    // an empty choice leaves the campus unchanged (server ignores an omitted campusId).
    try {
      await update(id, {
        name: editForm.name, year: Number(editForm.year),
        ...(editForm.campusId ? { campusId: editForm.campusId } : {}),
      });
      setEditId(null);
      fetch().catch(() => {});
      toast.success('Batch updated');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update batch');
    }
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Batches</h2>
          <button onClick={() => setShowForm(!showForm)}
            className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium">
            {showForm ? 'Cancel' : '+ New Batch'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 mb-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">New Batch</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-1">
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Batch Name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls} placeholder="e.g. Batch A 2025" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Year</label>
                <input type="number" required value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}
                  className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Campus</label>
                <select required value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value })}
                  className={inputCls + ' w-full'}>
                  <option value="">Select campus…</option>
                  {campusOptions('')}
                </select>
                {activeCampuses.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">No active campuses yet. Create one from the Campuses page first.</p>
                )}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Create Batch'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-2.5">Cancel</button>
            </div>
          </form>
        )}

        {loading ? <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p> : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {batches.length === 0 ? (
              <EmptyState title="No batches yet" description="Create a batch to start organising students." icon="clipboard" />
            ) : (
              <>
                {/* Mobile card list */}
                <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                  {batches.map((b) => (
                    <div key={b.id} className="px-4 py-4">
                      {editId === b.id ? (
                        <div className="space-y-3">
                          <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className={inlineInputCls + ' w-full'} />
                          <input type="number" value={editForm.year} onChange={(e) => setEditForm({ ...editForm, year: e.target.value })}
                            className={inlineInputCls + ' w-24'} />
                          <select value={editForm.campusId} onChange={(e) => setEditForm({ ...editForm, campusId: e.target.value })}
                            className={inlineInputCls + ' w-full'}>
                            <option value="">Select campus…</option>
                            {campusOptions(b.campusId ?? '')}
                          </select>
                          <div className="flex gap-3">
                            <button onClick={() => handleUpdate(b.id)} className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">Save</button>
                            <button onClick={() => setEditId(null)} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-gray-800 dark:text-gray-100">{b.name}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              Year {b.year} &middot; {b._count?.students ?? 0} students
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              <CampusPill campus={b.campus} />
                            </div>
                            {teachersForBatch(b.id).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {teachersForBatch(b.id).map((name) => (
                                  <span key={name} className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => startEdit(b)}
                            className="text-sm text-indigo-600 dark:text-indigo-400 font-medium px-2 py-1">Edit</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Name</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Year</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Campus</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Teachers</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Students</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {batches.map((b) => (
                        <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-4 py-3">
                            {editId === b.id
                              ? <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                  className={inlineInputCls} />
                              : <span className="font-medium text-gray-800 dark:text-gray-100">{b.name}</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                            {editId === b.id
                              ? <input type="number" value={editForm.year} onChange={(e) => setEditForm({ ...editForm, year: e.target.value })}
                                  className={`${inlineInputCls} w-20`} />
                              : b.year}
                          </td>
                          <td className="px-4 py-3">
                            {editId === b.id
                              ? <select value={editForm.campusId} onChange={(e) => setEditForm({ ...editForm, campusId: e.target.value })}
                                  className={inlineInputCls}>
                                  <option value="">Select campus…</option>
                                  {campusOptions(b.campusId ?? '')}
                                </select>
                              : <CampusPill campus={b.campus} />}
                          </td>
                          <td className="px-4 py-3">
                            {teachersForBatch(b.id).length === 0
                              ? <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                              : <div className="flex flex-wrap gap-1">
                                  {teachersForBatch(b.id).map((name) => (
                                    <span key={name} className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                                      {name}
                                    </span>
                                  ))}
                                </div>
                            }
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{b._count?.students ?? 0}</td>
                          <td className="px-4 py-3 text-right">
                            {editId === b.id ? (
                              <span className="flex gap-3 justify-end">
                                <button onClick={() => handleUpdate(b.id)} className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm font-medium">Save</button>
                                <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm">Cancel</button>
                              </span>
                            ) : (
                              <button onClick={() => startEdit(b)}
                                className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm font-medium">Edit</button>
                            )}
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
