import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useCampuses, Campus, LibrarySettings } from '../../hooks/useCampuses';
import Layout from '../../components/Layout';
import ConfirmModal from '../../components/ConfirmModal';
import EmptyState from '../../components/EmptyState';
import TagListEditor from '../../components/TagListEditor';

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed';
const labelCls = 'block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium';

interface CampusForm {
  name: string;
  code: string;
  libraryName: string;
  receiptAddress: string;
  receiptPhone: string;
  openingHours: string;
  shelfLocations: string[];
  categories: string[];
}

const emptyForm: CampusForm = {
  name: '', code: '', libraryName: '', receiptAddress: '', receiptPhone: '', openingHours: '',
  shelfLocations: [], categories: [],
};

interface RulesForm { loanDays: string; finePerDay: string; maxBooks: string; maxRenewals: string; fineBlockThreshold: string }

function rulesToForm(s: LibrarySettings): RulesForm {
  return {
    loanDays: String(s.loanDays), finePerDay: String(s.finePerDay), maxBooks: String(s.maxBooks),
    maxRenewals: String(s.maxRenewals), fineBlockThreshold: String(s.fineBlockThreshold),
  };
}

export default function Campuses() {
  const { campuses, settings, loading, fetchCampuses, createCampus, updateCampus, fetchSettings, updateSettings } = useCampuses();

  const [rules, setRules] = useState<RulesForm | null>(null);
  const [rulesSaving, setRulesSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<CampusForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [toggleTarget, setToggleTarget] = useState<Campus | null>(null);
  const [toggleSaving, setToggleSaving] = useState(false);

  useEffect(() => {
    fetchCampuses().catch(() => toast.error('Failed to load campuses'));
    fetchSettings().then((s) => setRules(rulesToForm(s))).catch(() => toast.error('Failed to load library rules'));
  }, [fetchCampuses, fetchSettings]);

  function openCreate() {
    setEditId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(c: Campus) {
    setEditId(c.id);
    setForm({
      name: c.name, code: c.code, libraryName: c.libraryName, receiptAddress: c.receiptAddress,
      receiptPhone: c.receiptPhone, openingHours: c.openingHours,
      shelfLocations: [...c.shelfLocations], categories: [...c.categories],
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeForm() { setShowForm(false); setEditId(null); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editId) {
        const { code: _code, ...rest } = form;
        await updateCampus(editId, rest);
        toast.success('Campus updated');
      } else {
        await createCampus({ ...form, code: form.code.trim().toUpperCase() });
        toast.success('Campus created');
      }
      closeForm();
      fetchCampuses().catch(() => {});
    } catch (e: any) {
      toast.error(e.response?.data?.message || (editId ? 'Failed to update campus' : 'Failed to create campus'));
    } finally { setSaving(false); }
  }

  async function handleToggle() {
    if (!toggleTarget) return;
    setToggleSaving(true);
    try {
      await updateCampus(toggleTarget.id, { isActive: !toggleTarget.isActive });
      toast.success(toggleTarget.isActive ? 'Campus deactivated' : 'Campus activated');
      setToggleTarget(null);
      fetchCampuses().catch(() => {});
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update campus');
    } finally { setToggleSaving(false); }
  }

  async function handleSaveRules(e: React.FormEvent) {
    e.preventDefault();
    if (!rules) return;
    setRulesSaving(true);
    try {
      const s = await updateSettings({
        loanDays: Number(rules.loanDays),
        finePerDay: Number(rules.finePerDay),
        maxBooks: Number(rules.maxBooks),
        maxRenewals: Number(rules.maxRenewals),
        fineBlockThreshold: Number(rules.fineBlockThreshold),
      });
      setRules(rulesToForm(s));
      toast.success('Library rules saved');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to save library rules');
    } finally { setRulesSaving(false); }
  }

  const ruleFields: { key: keyof RulesForm; label: string; min: number; step?: string }[] = [
    { key: 'loanDays', label: 'Loan days', min: 1 },
    { key: 'finePerDay', label: 'Fine per day (₹)', min: 0, step: '0.01' },
    { key: 'maxBooks', label: 'Max books per member', min: 1 },
    { key: 'maxRenewals', label: 'Max renewals', min: 0 },
    { key: 'fineBlockThreshold', label: 'Fine block threshold (₹)', min: 0, step: '0.01' },
  ];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        {/* Library rules */}
        <form onSubmit={handleSaveRules} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 mb-6">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Library rules (all campuses)</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-4">These rules apply to every campus library.</p>
          {!rules ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {ruleFields.map((f) => (
                  <div key={f.key}>
                    <label className={labelCls}>{f.label}</label>
                    <input type="number" required min={f.min} step={f.step ?? '1'} value={rules[f.key]}
                      onChange={(e) => setRules({ ...rules, [f.key]: e.target.value })}
                      className={inputCls} />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button type="submit" disabled={rulesSaving}
                  className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                  {rulesSaving ? 'Saving…' : 'Save rules'}
                </button>
                {settings?.updatedAt && (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    Last updated {new Date(settings.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            </>
          )}
        </form>

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Campuses</h2>
          <button onClick={() => (showForm ? closeForm() : openCreate())}
            className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium">
            {showForm ? 'Cancel' : '+ New Campus'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className={`bg-white dark:bg-gray-800 border rounded-2xl p-5 mb-4 space-y-3 ${editId ? 'border-indigo-200 dark:border-indigo-700' : 'border-gray-200 dark:border-gray-700'}`}>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{editId ? 'Edit Campus' : 'New Campus'}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Campus name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls} placeholder="e.g. IG-1" />
              </div>
              <div>
                <label className={labelCls}>Code</label>
                <input required disabled={!!editId} value={form.code} maxLength={6}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                  className={inputCls + ' font-mono'} placeholder="e.g. IG1" />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                  {editId
                    ? "Code is used in catalog numbers and can't be changed"
                    : '2–6 letters or digits. Used in catalog numbers; cannot be changed later.'}
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Library name</label>
                <input value={form.libraryName} onChange={(e) => setForm({ ...form, libraryName: e.target.value })}
                  className={inputCls} placeholder="e.g. DOPA Library, IG-1" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Receipt address</label>
                <textarea rows={3} value={form.receiptAddress} onChange={(e) => setForm({ ...form, receiptAddress: e.target.value })}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Receipt phone</label>
                <input value={form.receiptPhone} onChange={(e) => setForm({ ...form, receiptPhone: e.target.value })}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Opening hours</label>
                <input value={form.openingHours} onChange={(e) => setForm({ ...form, openingHours: e.target.value })}
                  className={inputCls} placeholder="e.g. Mon–Sat 9am–5pm" />
              </div>
            </div>
            <TagListEditor label="Shelf locations" values={form.shelfLocations}
              onChange={(v) => setForm({ ...form, shelfLocations: v })} placeholder="e.g. Rack A1" />
            <TagListEditor label="Categories" values={form.categories}
              onChange={(v) => setForm({ ...form, categories: v })} placeholder="e.g. Physics" />
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Campus'}
              </button>
              <button type="button" onClick={closeForm}
                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-2.5">Cancel</button>
            </div>
          </form>
        )}

        <ConfirmModal
          open={!!toggleTarget}
          title={toggleTarget?.isActive ? 'Deactivate Campus' : 'Activate Campus'}
          message={toggleTarget?.isActive
            ? 'Deactivating is blocked while the campus still has active batches or staff with library access. You can reactivate it later.'
            : 'This campus will become available again for batches and library staff.'}
          confirmLabel={toggleTarget?.isActive ? 'Deactivate' : 'Activate'}
          danger={toggleTarget?.isActive}
          loading={toggleSaving}
          onConfirm={handleToggle}
          onCancel={() => setToggleTarget(null)}
        />

        {loading && campuses.length === 0 ? <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p> : campuses.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
            <EmptyState title="No campuses yet" description="Create a campus to group batches and set up its library." icon="clipboard" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {campuses.map((c) => (
              <div key={c.id}
                className={`bg-white dark:bg-gray-800 rounded-2xl border p-5 ${editId === c.id ? 'border-indigo-300 dark:border-indigo-600' : 'border-gray-200 dark:border-gray-700'} ${c.isActive ? '' : 'opacity-50'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 dark:text-gray-100 text-base">{c.name}</p>
                    <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mt-0.5">{c.code}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${c.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {c.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{c.libraryName || <span className="text-gray-300 dark:text-gray-600">No library name</span>}</p>
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {(c.batches ?? []).length === 0
                    ? <span className="text-xs text-gray-300 dark:text-gray-600">No batches</span>
                    : (c.batches ?? []).map((b) => (
                        <span key={b.id} className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                          {b.name}
                        </span>
                      ))}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2.5">
                  {c.shelfLocations.length} shelf location{c.shelfLocations.length === 1 ? '' : 's'} &middot; {c.categories.length} categor{c.categories.length === 1 ? 'y' : 'ies'}
                </p>
                <div className="flex gap-4 mt-3">
                  <button onClick={() => openEdit(c)} className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">Edit</button>
                  <button onClick={() => setToggleTarget(c)} className="text-sm text-gray-400 hover:text-red-600 dark:hover:text-red-400">
                    {c.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
