import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useLibrary } from '../../hooks/useLibrary';
import Layout from '../../components/Layout';
import TagListEditor from '../../components/TagListEditor';

export default function LibrarySettings() {
  const { me, loading, fetchMe, updateCatalogSettings } = useLibrary();
  const [campusId, setCampusId] = useState('');
  const [shelves, setShelves] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library'));
  }, [fetchMe]);

  // Default the selected campus once /library/me has loaded.
  useEffect(() => {
    if (!me || campusId) return;
    setCampusId(me.campus?.id ?? me.campuses[0]?.id ?? '');
  }, [me, campusId]);

  const campus = me?.campuses.find((c) => c.id === campusId) ?? (me?.campus?.id === campusId ? me.campus : null);

  useEffect(() => {
    if (!campus) return;
    setShelves([...campus.shelfLocations]);
    setCategories([...campus.categories]);
  }, [campus]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!campusId) return;
    setSaving(true);
    try {
      await updateCatalogSettings(campusId, { shelfLocations: shelves, categories });
      await fetchMe();
      toast.success('Library settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to save library settings');
    } finally { setSaving(false); }
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Library Settings</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Shelf locations and book categories used when cataloguing books.</p>
        </div>

        {loading && !me && <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p>}

        {me && !campus && (
          <p className="text-sm text-gray-400 dark:text-gray-500">No campus available.</p>
        )}

        {me && campus && (
          <form onSubmit={handleSave} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-4">
            {me.isAdmin ? (
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">Campus</label>
                <select value={campusId} onChange={(e) => setCampusId(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {me.campuses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </select>
              </div>
            ) : (
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{campus.name} ({campus.code})</p>
            )}
            <TagListEditor label="Shelf locations" values={shelves} onChange={setShelves} placeholder="e.g. Rack A1"
              hint="Press Enter or Add. Duplicates (ignoring case) are removed." />
            <TagListEditor label="Categories" values={categories} onChange={setCategories} placeholder="e.g. Physics" />
            <div className="pt-1">
              <button type="submit" disabled={saving}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}
