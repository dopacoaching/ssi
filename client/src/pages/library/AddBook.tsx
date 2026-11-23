import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import { useLibrary } from '../../hooks/useLibrary';
import { useCatalog, type AddResult, type Book } from '../../hooks/useCatalog';
import { PrintLabelsPanel, inputCls, labelCls, primaryBtn, ghostBtn } from '../../components/LibraryBits';

const empty = {
  title: '', author: '', category: '', shelfLocation: '', copies: '1', price: '',
  publisher: '', edition: '', year: '', isbn: '', remarks: '',
};

export default function AddBook() {
  const { me, fetchMe } = useLibrary();
  const { createBook, addCopies, findSimilar } = useCatalog();
  const [campusId, setCampusId] = useState('');
  const [form, setForm] = useState(empty);
  const [similar, setSimilar] = useState<Book[]>([]);
  const [target, setTarget] = useState<Book | null>(null); // add copies to this book instead
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AddResult | null>(null);

  useEffect(() => {
    fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library'));
  }, [fetchMe]);

  useEffect(() => {
    if (me && !campusId) setCampusId(me.isAdmin ? (me.campuses.length === 1 ? me.campuses[0].id : '') : me.campus?.id ?? '');
  }, [me, campusId]);

  const campus = me?.campuses.find((c) => c.id === campusId) ?? (me?.campus?.id === campusId ? me.campus : null);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Debounced similar-books lookup
  const title = form.title.trim();
  useEffect(() => {
    if (target || title.length < 3 || !campusId) { setSimilar([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      findSimilar(title, form.author.trim(), me?.isAdmin ? campusId : undefined)
        .then((r) => { if (!cancelled) setSimilar(r); })
        .catch(() => { if (!cancelled) setSimilar([]); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [title, form.author, campusId, target, findSimilar, me?.isAdmin]);

  const labels = useMemo(() => {
    if (!result) return [];
    const code = result.book.campus?.code || campus?.code || '';
    return result.copies.map((c) => ({ catalogNumber: c.catalogNumber, title: result.book.title, campusCode: code }));
  }, [result, campus]);

  function reset() { setForm(empty); setSimilar([]); setTarget(null); setResult(null); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (me?.isAdmin && !campusId) { toast.error('Select a campus'); return; }
    const count = Number(form.copies);
    if (!Number.isInteger(count) || count < 1 || count > 200) { toast.error('Copies must be a whole number from 1 to 200'); return; }
    setSaving(true);
    try {
      if (target) {
        const r = await addCopies(target.id, { count, shelfLocation: form.shelfLocation.trim(), remarks: form.remarks.trim() });
        setResult(r);
        toast.success(`${r.copies.length} ${r.copies.length === 1 ? 'copy' : 'copies'} added`);
      } else {
        if (!title) { toast.error('Title is required'); setSaving(false); return; }
        const r = await createBook({
          ...(me?.isAdmin ? { campusId } : {}),
          title,
          author: form.author.trim(), category: form.category.trim(), publisher: form.publisher.trim(),
          edition: form.edition.trim(), isbn: form.isbn.trim(), remarks: '',
          year: form.year.trim() ? Number(form.year) : null,
          price: form.price.trim() ? Number(form.price) : null,
          copies: count, shelfLocation: form.shelfLocation.trim(), copyRemarks: form.remarks.trim(),
        });
        setResult(r);
        toast.success('Book added');
      }
      fetchMe().catch(() => {}); // refresh category/shelf lists
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-5">
          <Link to="/library/catalog" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">← Catalog</Link>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mt-1">Add book</h2>
        </div>

        {result ? (
          <div className="space-y-4">
            <PrintLabelsPanel
              title={`${result.copies.length} ${result.copies.length === 1 ? 'copy' : 'copies'} added to "${result.book.title}"`}
              labels={labels}
            />
            <div className="flex gap-2">
              <button type="button" onClick={reset} className={primaryBtn}>Add another</button>
              <Link to={`/library/books/${result.book.id}`} className={ghostBtn}>View book</Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-4">
            {me?.isAdmin && (
              <div>
                <label className={labelCls}>Campus *</label>
                <select value={campusId} onChange={(e) => { setCampusId(e.target.value); setTarget(null); }} className={inputCls}>
                  <option value="">Select campus…</option>
                  {me.campuses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </select>
              </div>
            )}

            {target ? (
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-indigo-600 dark:text-indigo-300 font-medium">Adding copies to existing book</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 break-words">{target.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{target.author || 'No author'} · {target.copyCounts.total} copies</p>
                </div>
                <button type="button" onClick={() => setTarget(null)} className="text-xs text-indigo-600 dark:text-indigo-300 hover:underline whitespace-nowrap">Add as new book</button>
              </div>
            ) : (
              <>
                <div>
                  <label className={labelCls}>Title *</label>
                  <input value={form.title} onChange={set('title')} maxLength={300} className={inputCls} autoFocus />
                </div>

                {similar.length > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Similar books already in this library</p>
                    {similar.map((b) => (
                      <div key={b.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-800 dark:text-gray-100 break-words">{b.title}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{b.author || 'No author'} · {b.copyCounts.total} copies</p>
                        </div>
                        <button type="button" onClick={() => { setTarget(b); setSimilar([]); }}
                          className="text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:underline text-right flex-shrink-0">
                          Add copies to this book instead
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Author</label>
                    <input value={form.author} onChange={set('author')} maxLength={300} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Category</label>
                    <input value={form.category} onChange={set('category')} list="cat-list" maxLength={100} className={inputCls} placeholder="Pick or type new" />
                    <datalist id="cat-list">{campus?.categories.map((c) => <option key={c} value={c} />)}</datalist>
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Shelf location</label>
                <input value={form.shelfLocation} onChange={set('shelfLocation')} list="shelf-list" maxLength={100} className={inputCls} placeholder="Pick or type new" />
                <datalist id="shelf-list">{campus?.shelfLocations.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <label className={labelCls}>Copies (1-200)</label>
                <input type="number" min={1} max={200} value={form.copies} onChange={set('copies')} className={inputCls} />
              </div>
            </div>

            {!target && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Price</label>
                  <input type="number" min={0} step="0.01" value={form.price} onChange={set('price')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Publisher</label>
                  <input value={form.publisher} onChange={set('publisher')} maxLength={300} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Edition</label>
                  <input value={form.edition} onChange={set('edition')} maxLength={300} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Year</label>
                  <input type="number" value={form.year} onChange={set('year')} className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>ISBN</label>
                  <input value={form.isbn} onChange={set('isbn')} maxLength={300} className={inputCls} />
                </div>
              </div>
            )}

            <div>
              <label className={labelCls}>Remarks {target ? '' : '(applied to each copy)'}</label>
              <input value={form.remarks} onChange={set('remarks')} maxLength={300} className={inputCls} />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving} className={primaryBtn}>
                {saving ? 'Saving…' : target ? 'Add copies' : 'Add book'}
              </button>
              <Link to="/library/catalog" className={ghostBtn}>Cancel</Link>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}
