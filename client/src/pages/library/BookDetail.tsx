import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import ConfirmModal from '../../components/ConfirmModal';
import ReasonModal from '../../components/ReasonModal';
import { useLibrary } from '../../hooks/useLibrary';
import { useCatalog, type AddResult, type Book, type BookCopy, type HistoryEntry } from '../../hooks/useCatalog';
import type { LoanView } from '../../hooks/useCirculation';
import { CopyLoanInfo, WaivedDaysNote, OverdueChip, conditionLabel, fmtDay, fmtYmd, money } from '../../components/CirculationBits';
import { printLabelSheet } from '../../utils/libraryLabels';
import { StatusChip, CampusPill, PrintLabelsPanel, fmtDateTime, inputCls, labelCls, primaryBtn, ghostBtn } from '../../components/LibraryBits';

const card = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5';

export default function BookDetail() {
  const { id = '' } = useParams();
  return <BookDetailInner key={id} id={id} />; // remount on route change to reset edit/selection state
}

function lostInfo(c: BookCopy) {
  const src = c.lostSource === 'STOCK_CHECK' ? 'missing at stock check' : c.lostSource === 'LOAN' ? 'reported lost by student' : 'lost';
  return `Lost ${c.lostAt ? fmtDay(c.lostAt) : ''} (${src})${c.lostReason ? `: ${c.lostReason}` : ''}`;
}

function wasLabel(c: BookCopy) {
  return c.status === 'WITHDRAWN' && c.statusBeforeWithdraw ? ` (was ${c.statusBeforeWithdraw === 'DAMAGED' ? 'Damaged' : 'Available'})` : '';
}

function BookDetailInner({ id }: { id: string }) {
  const { me, fetchMe } = useLibrary();
  const { getBook, updateBook, updateCopy, withdrawCopy, reinstateCopy, addCopies, markFound, markRepaired } = useCatalog();

  const [book, setBook] = useState<Book | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loans, setLoans] = useState<LoanView[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [copyEditId, setCopyEditId] = useState<string | null>(null);
  const [copyForm, setCopyForm] = useState({ shelfLocation: '', remarks: '' });
  const [copySaving, setCopySaving] = useState(false);

  const [withdrawing, setWithdrawing] = useState<BookCopy | null>(null);
  const [reason, setReason] = useState('');
  const [wLoading, setWLoading] = useState(false);
  const [reinstating, setReinstating] = useState<BookCopy | null>(null);
  const [fixing, setFixing] = useState<{ copy: BookCopy; kind: 'found' | 'repair' } | null>(null);
  const [rLoading, setRLoading] = useState(false);

  const [addForm, setAddForm] = useState({ count: '1', shelfLocation: '', remarks: '' });
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<AddResult | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [startAt, setStartAt] = useState('1');

  const load = useCallback(async () => {
    try {
      const r = await getBook(id);
      setBook(r.book); setHistory(r.history); setLoans(r.loans ?? []); setNotFound(false);
    } catch (e: any) {
      if (e.response?.status === 404) setNotFound(true);
      toast.error(e.response?.data?.message || 'Failed to load book');
    } finally { setLoading(false); }
  }, [getBook, id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchMe().catch(() => {}); }, [fetchMe]);

  const isAdmin = !!me?.isAdmin;
  const campus = me?.campuses.find((c) => c.id === book?.campusId) ?? (me?.campus?.id === book?.campusId ? me?.campus : null);
  const code = book?.campus?.code || campus?.code || '';
  const copies = book?.copies ?? [];

  const labelsFor = useMemo(() => (list: BookCopy[]) =>
    list.map((c) => ({ catalogNumber: c.catalogNumber, title: book?.title ?? '', campusCode: code })), [book, code]);

  function startEdit() {
    if (!book) return;
    setForm({
      title: book.title, author: book.author, category: book.category, publisher: book.publisher, edition: book.edition,
      year: book.year == null ? '' : String(book.year), isbn: book.isbn, price: book.price == null ? '' : String(book.price), remarks: book.remarks,
    });
    setEditing(true);
  }

  async function saveBook(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      await updateBook(id, {
        title: form.title.trim(), author: form.author.trim(), category: form.category.trim(), publisher: form.publisher.trim(),
        edition: form.edition.trim(), isbn: form.isbn.trim(), remarks: form.remarks.trim(),
        year: form.year.trim() ? Number(form.year) : null, price: form.price.trim() ? Number(form.price) : null,
      });
      toast.success('Book updated');
      setEditing(false);
      await load();
      fetchMe().catch(() => {});
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update book');
    } finally { setSaving(false); }
  }

  async function saveCopy(copyId: string) {
    setCopySaving(true);
    try {
      await updateCopy(copyId, { shelfLocation: copyForm.shelfLocation.trim(), remarks: copyForm.remarks.trim() });
      toast.success('Copy updated');
      setCopyEditId(null);
      await load();
      fetchMe().catch(() => {});
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update copy');
    } finally { setCopySaving(false); }
  }

  async function doWithdraw() {
    if (!withdrawing) return;
    if (!reason.trim()) { toast.error('A reason is required'); return; }
    setWLoading(true);
    try {
      await withdrawCopy(withdrawing.id, reason.trim());
      toast.success(`${withdrawing.catalogNumber} withdrawn`);
      setWithdrawing(null); setReason('');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to withdraw copy');
    } finally { setWLoading(false); }
  }

  async function doReinstate() {
    if (!reinstating) return;
    setRLoading(true);
    try {
      await reinstateCopy(reinstating.id);
      toast.success(`${reinstating.catalogNumber} reinstated`);
      setReinstating(null);
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to reinstate copy');
    } finally { setRLoading(false); }
  }

  async function doAddCopies(e: React.FormEvent) {
    e.preventDefault();
    const count = Number(addForm.count);
    if (!Number.isInteger(count) || count < 1 || count > 200) { toast.error('Copies must be a whole number from 1 to 200'); return; }
    setAdding(true);
    try {
      const r = await addCopies(id, { count, shelfLocation: addForm.shelfLocation.trim(), remarks: addForm.remarks.trim() });
      setAdded(r);
      toast.success(`${r.copies.length} ${r.copies.length === 1 ? 'copy' : 'copies'} added`);
      setAddForm({ count: '1', shelfLocation: '', remarks: '' });
      await load();
      fetchMe().catch(() => {});
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to add copies');
    } finally { setAdding(false); }
  }

  const toggleSel = (cid: string) => setSelected((s) => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  const printTargets = selected.size > 0 ? copies.filter((c) => selected.has(c.id)) : copies;
  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (loading) {
    return <Layout><div className="max-w-4xl mx-auto space-y-4">{[1, 2].map((n) => <div key={n} className="h-40 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}</div></Layout>;
  }
  if (!book) {
    return (
      <Layout><div className="max-w-4xl mx-auto">
        <Link to="/library/catalog" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">← Catalog</Link>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">{notFound ? 'Book not found.' : 'Could not load this book.'}</p>
      </div></Layout>
    );
  }

  const details: [string, string][] = [
    ['Author', book.author], ['Category', book.category], ['Publisher', book.publisher], ['Edition', book.edition],
    ['Year', book.year == null ? '' : String(book.year)], ['ISBN', book.isbn],
    ['Price', book.price == null ? '' : `₹${book.price}`], ['Remarks', book.remarks],
  ];

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <Link to="/library/catalog" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">← Catalog</Link>
        </div>

        {/* Details */}
        <div className={card}>
          {editing ? (
            <form onSubmit={saveBook} className="space-y-4">
              <div>
                <label className={labelCls}>Title *</label>
                <input value={form.title} onChange={setF('title')} maxLength={300} className={inputCls} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className={labelCls}>Author</label><input value={form.author} onChange={setF('author')} maxLength={300} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>Category</label>
                  <input value={form.category} onChange={setF('category')} list="bd-cat" maxLength={100} className={inputCls} />
                  <datalist id="bd-cat">{campus?.categories.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
                <div><label className={labelCls}>Publisher</label><input value={form.publisher} onChange={setF('publisher')} maxLength={300} className={inputCls} /></div>
                <div><label className={labelCls}>Edition</label><input value={form.edition} onChange={setF('edition')} maxLength={300} className={inputCls} /></div>
                <div><label className={labelCls}>Year</label><input type="number" value={form.year} onChange={setF('year')} className={inputCls} /></div>
                <div><label className={labelCls}>Price</label><input type="number" min={0} step="0.01" value={form.price} onChange={setF('price')} className={inputCls} /></div>
                <div><label className={labelCls}>ISBN</label><input value={form.isbn} onChange={setF('isbn')} maxLength={300} className={inputCls} /></div>
                <div><label className={labelCls}>Remarks</label><input value={form.remarks} onChange={setF('remarks')} maxLength={300} className={inputCls} /></div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(false)} className={ghostBtn}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 break-words">{book.title}</h2>
                    {isAdmin && book.campus && <CampusPill code={book.campus.code} />}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{book.copyCounts.total} copies</span>
                    {(['AVAILABLE', 'ISSUED', 'DAMAGED', 'LOST', 'WITHDRAWN'] as const).filter((s) => book.copyCounts[s] > 0)
                      .map((s) => <StatusChip key={s} status={s} count={book.copyCounts[s]} />)}
                  </div>
                </div>
                <button type="button" onClick={startEdit} className={ghostBtn}>Edit</button>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                {details.map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-xs text-gray-400 dark:text-gray-500">{k}</dt>
                    <dd className="text-sm text-gray-800 dark:text-gray-100 break-words">{v || '—'}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>

        {/* Copies */}
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Copies</p>
            {copies.length > 0 && (
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={24} value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-label="Start at label"
                  title="Start at label (1-24)" className="w-16 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl px-2 py-2 text-sm" />
                <button type="button" onClick={() => printLabelSheet(labelsFor(printTargets), { startAt: Number(startAt) || 1 })} className={ghostBtn}>
                  Print labels ({selected.size > 0 ? `${selected.size} selected` : 'all'})
                </button>
              </div>
            )}
          </div>

          {copies.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No copies yet.</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                      <th className="py-2 pr-2 w-8" />
                      <th className="py-2 pr-3 font-medium">Catalog no.</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Shelf</th>
                      <th className="py-2 pr-3 font-medium">Remarks</th>
                      <th className="py-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {copies.map((c) => (
                      <tr key={c.id} className="border-b border-gray-50 dark:border-gray-700/50 align-top">
                        <td className="py-2.5 pr-2"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} aria-label={`Select ${c.catalogNumber}`} /></td>
                        <td className="py-2.5 pr-3 font-mono text-gray-800 dark:text-gray-100 whitespace-nowrap">{c.catalogNumber}</td>
                        <td className="py-2.5 pr-3"><StatusChip status={c.status} />{c.status === 'ISSUED' && c.loan && <CopyLoanInfo loan={c.loan} />}</td>
                        {copyEditId === c.id ? (
                          <>
                            <td className="py-2 pr-3">
                              <input value={copyForm.shelfLocation} onChange={(e) => setCopyForm((f) => ({ ...f, shelfLocation: e.target.value }))} list="bd-shelf" className={inputCls} />
                            </td>
                            <td className="py-2 pr-3">
                              <input value={copyForm.remarks} onChange={(e) => setCopyForm((f) => ({ ...f, remarks: e.target.value }))} className={inputCls} />
                            </td>
                            <td className="py-2 text-right whitespace-nowrap">
                              <button type="button" disabled={copySaving} onClick={() => saveCopy(c.id)} className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mr-3">Save</button>
                              <button type="button" onClick={() => setCopyEditId(null)} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300">{c.shelfLocation || '—'}</td>
                            <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300 break-words max-w-xs">
                              {c.remarks || '—'}
                              {c.status === 'WITHDRAWN' && (c.withdrawReason || c.statusBeforeWithdraw) && <span className="block text-xs text-gray-400 dark:text-gray-500">Withdrawn{wasLabel(c)}: {c.withdrawReason}</span>}
                              {c.status === 'LOST' && <span className="block text-xs text-red-600 dark:text-red-300">{lostInfo(c)}</span>}
                              {c.status !== 'LOST' && c.foundAt && <span className="block text-xs text-gray-400 dark:text-gray-500">Last found {fmtDay(c.foundAt)}</span>}
                              {c.status !== 'DAMAGED' && c.repairedAt && <span className="block text-xs text-gray-400 dark:text-gray-500">Last repaired {fmtDay(c.repairedAt)}</span>}
                            </td>
                            <td className="py-2.5 text-right whitespace-nowrap">
                              <CopyActions c={c} isAdmin={isAdmin}
                                onEdit={() => { setCopyEditId(c.id); setCopyForm({ shelfLocation: c.shelfLocation, remarks: c.remarks }); }}
                                onWithdraw={() => { setWithdrawing(c); setReason(''); }} onReinstate={() => setReinstating(c)}
                                onFound={() => setFixing({ copy: c, kind: 'found' })} onRepair={() => setFixing({ copy: c, kind: 'repair' })} />
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {copies.map((c) => (
                  <div key={c.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 font-mono text-sm text-gray-800 dark:text-gray-100">
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} />{c.catalogNumber}
                      </label>
                      <StatusChip status={c.status} />
                    </div>
                    {c.status === 'ISSUED' && c.loan && <CopyLoanInfo loan={c.loan} />}
                    {copyEditId === c.id ? (
                      <div className="mt-2 space-y-2">
                        <input value={copyForm.shelfLocation} onChange={(e) => setCopyForm((f) => ({ ...f, shelfLocation: e.target.value }))} list="bd-shelf" placeholder="Shelf" className={inputCls} />
                        <input value={copyForm.remarks} onChange={(e) => setCopyForm((f) => ({ ...f, remarks: e.target.value }))} placeholder="Remarks" className={inputCls} />
                        <div className="flex gap-3">
                          <button type="button" disabled={copySaving} onClick={() => saveCopy(c.id)} className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Save</button>
                          <button type="button" onClick={() => setCopyEditId(null)} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Shelf: {c.shelfLocation || '—'}</p>
                        {c.remarks && <p className="text-xs text-gray-500 dark:text-gray-400">Remarks: {c.remarks}</p>}
                        {c.status === 'WITHDRAWN' && (c.withdrawReason || c.statusBeforeWithdraw) && <p className="text-xs text-gray-400 dark:text-gray-500">Withdrawn{wasLabel(c)}: {c.withdrawReason}</p>}
                        {c.status === 'LOST' && <p className="text-xs text-red-600 dark:text-red-300">{lostInfo(c)}</p>}
                        {c.status !== 'LOST' && c.foundAt && <p className="text-xs text-gray-400 dark:text-gray-500">Last found {fmtDay(c.foundAt)}</p>}
                        {c.status !== 'DAMAGED' && c.repairedAt && <p className="text-xs text-gray-400 dark:text-gray-500">Last repaired {fmtDay(c.repairedAt)}</p>}
                        <div className="mt-2">
                          <CopyActions c={c} isAdmin={isAdmin}
                            onEdit={() => { setCopyEditId(c.id); setCopyForm({ shelfLocation: c.shelfLocation, remarks: c.remarks }); }}
                            onWithdraw={() => { setWithdrawing(c); setReason(''); }} onReinstate={() => setReinstating(c)}
                                onFound={() => setFixing({ copy: c, kind: 'found' })} onRepair={() => setFixing({ copy: c, kind: 'repair' })} />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <datalist id="bd-shelf">{campus?.shelfLocations.map((s) => <option key={s} value={s} />)}</datalist>
            </>
          )}
        </div>

        {/* Add copies */}
        <div className={card}>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Add copies</p>
          <form onSubmit={doAddCopies} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className={labelCls}>Count (1-200)</label>
              <input type="number" min={1} max={200} value={addForm.count} onChange={(e) => setAddForm((f) => ({ ...f, count: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Shelf location</label>
              <input value={addForm.shelfLocation} onChange={(e) => setAddForm((f) => ({ ...f, shelfLocation: e.target.value }))} list="bd-shelf" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Remarks</label>
              <input value={addForm.remarks} onChange={(e) => setAddForm((f) => ({ ...f, remarks: e.target.value }))} className={inputCls} />
            </div>
            <button type="submit" disabled={adding} className={primaryBtn}>{adding ? 'Adding…' : 'Add copies'}</button>
          </form>
          {added && (
            <div className="mt-4">
              <PrintLabelsPanel title={`${added.copies.length} ${added.copies.length === 1 ? 'copy' : 'copies'} added`} labels={labelsFor(added.copies)}>
                <button type="button" onClick={() => setAdded(null)} className="text-xs text-gray-500 dark:text-gray-400 hover:underline pb-2.5">Dismiss</button>
              </PrintLabelsPanel>
            </div>
          )}
        </div>

        {/* History */}
        <div className={card}>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">History</p>
          {history.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No history yet.</p>
          ) : (
            <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-2 space-y-4">
              {history.map((h) => (
                <li key={h.id} className="pl-4 relative">
                  <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-400 dark:bg-indigo-500" />
                  <p className="text-sm text-gray-800 dark:text-gray-100 break-words">{h.description}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{h.userName} · {fmtDateTime(h.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Loan history */}
        <div className={card}>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Loan history</p>
          {loans.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No loans yet.</p>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                    <th className="py-2 pr-3 font-medium">Student</th><th className="py-2 pr-3 font-medium">Copy</th>
                    <th className="py-2 pr-3 font-medium">Issued</th><th className="py-2 pr-3 font-medium">Due</th>
                    <th className="py-2 pr-3 font-medium">Returned</th><th className="py-2 pr-3 font-medium text-right">Days late</th>
                    <th className="py-2 pr-3 font-medium text-right">Fine</th><th className="py-2 font-medium">Condition</th>
                  </tr></thead>
                  <tbody>{loans.map((l) => (
                    <tr key={l.id} className="border-b border-gray-50 dark:border-gray-700/50 text-gray-800 dark:text-gray-100 align-top">
                      <td className="py-2 pr-3"><Link to={`/library/students/${l.student.regNumber}`} className="hover:underline">{l.student.fullName}</Link>
                        <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{l.student.regNumber}</p></td>
                      <td className="py-2 pr-3 font-mono text-xs">{l.copy.catalogNumber}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtDay(l.issuedAt)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtYmd(l.dueDate)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{l.status === 'OPEN' ? (l.isOverdue ? <OverdueChip days={l.daysLate} /> : 'Open') : l.status === 'LOST' ? <span className="text-red-600 dark:text-red-300">Lost {fmtDay(l.lostAt)}{l.foundAt ? ` (found ${fmtDay(l.foundAt)})` : ''}</span> : fmtDay(l.returnedAt)}</td>
                      <td className="py-2 pr-3 text-right">{l.daysLate}{(l.waivedDays ?? 0) > 0 && <div><WaivedDaysNote days={l.waivedDays!} /></div>}</td>
                      <td className={`py-2 pr-3 text-right ${l.lateFine > 0 ? 'text-red-600 dark:text-red-300 font-semibold' : ''}`}>{money(l.lateFine)}</td>
                      <td className="py-2 text-xs">{conditionLabel(l.condition)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
              <div className="md:hidden space-y-2">{loans.map((l) => (
                <div key={l.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 text-sm">
                  <Link to={`/library/students/${l.student.regNumber}`} className="font-medium text-gray-800 dark:text-gray-100">{l.student.fullName}</Link>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5"><span className="font-mono">{l.copy.catalogNumber}</span> · {fmtDay(l.issuedAt)} to {l.status === 'OPEN' ? 'now' : l.status === 'LOST' ? `lost ${fmtDay(l.lostAt)}` : fmtDay(l.returnedAt)} (due {fmtYmd(l.dueDate)})</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{l.daysLate} days late · fine {money(l.lateFine)} · {conditionLabel(l.condition)}</p>
                  {(l.waivedDays ?? 0) > 0 && <p className="mt-0.5"><WaivedDaysNote days={l.waivedDays!} /></p>}
                </div>))}
              </div>
            </>
          )}
        </div>
      </div>

      {fixing && (
        <ReasonModal
          title={fixing.kind === 'found' ? `Mark ${fixing.copy.catalogNumber} found` : `Mark ${fixing.copy.catalogNumber} repaired`}
          message={fixing.kind === 'found' ? 'The copy returns to Available. Any charges already raised stay as they are (use a waiver request if needed).' : 'The copy returns to Available.'}
          label="Note" required={false} confirmLabel={fixing.kind === 'found' ? 'Mark found' : 'Mark repaired'}
          onClose={() => setFixing(null)}
          onSubmit={async (note) => {
            if (fixing.kind === 'found') await markFound(fixing.copy.id, note || undefined);
            else await markRepaired(fixing.copy.id, note || undefined);
            toast.success(`${fixing.copy.catalogNumber} marked ${fixing.kind === 'found' ? 'found' : 'repaired'}`);
            setFixing(null);
            await load();
          }} />
      )}

      {/* Withdraw modal */}
      {withdrawing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => !wLoading && setWithdrawing(null)} aria-hidden="true" />
          <form role="dialog" aria-modal="true" aria-labelledby="wd-title" onSubmit={(e) => { e.preventDefault(); doWithdraw(); }}
            className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 id="wd-title" className="text-base font-semibold text-gray-800 dark:text-gray-100">Withdraw {withdrawing.catalogNumber}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">The copy is removed from circulation. Give a reason for the record.</p>
            <div>
              <label className={labelCls}>Reason *</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus className={inputCls} placeholder="e.g. Torn pages, beyond repair" />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={wLoading || !reason.trim()} className="flex-1 py-2.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-xl font-medium disabled:opacity-60">
                {wLoading ? 'Withdrawing…' : 'Withdraw'}
              </button>
              <button type="button" disabled={wLoading} onClick={() => setWithdrawing(null)} className={ghostBtn}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <ConfirmModal open={!!reinstating} title="Reinstate copy"
        message={`Return ${reinstating?.catalogNumber ?? ''} to ${reinstating?.statusBeforeWithdraw === 'DAMAGED' ? 'Damaged' : 'Available'} status?`} confirmLabel="Reinstate"
        loading={rLoading} onConfirm={doReinstate} onCancel={() => setReinstating(null)} />
    </Layout>
  );
}

function CopyActions({ c, isAdmin, onEdit, onWithdraw, onReinstate, onFound, onRepair }: {
  c: BookCopy; isAdmin: boolean; onEdit: () => void; onWithdraw: () => void; onReinstate: () => void; onFound: () => void; onRepair: () => void;
}) {
  const btn = 'text-xs font-medium';
  return (
    <span className="inline-flex gap-3">
      <button type="button" onClick={onEdit} className={`${btn} text-indigo-600 dark:text-indigo-400`}>Edit</button>
      {(c.status === 'AVAILABLE' || c.status === 'DAMAGED') && (
        <button type="button" onClick={onWithdraw} className={`${btn} text-red-600 dark:text-red-400`}>Withdraw</button>
      )}
      {c.status === 'DAMAGED' && <button type="button" onClick={onRepair} className={`${btn} text-emerald-600 dark:text-emerald-400`}>Mark repaired</button>}
      {c.status === 'LOST' && <button type="button" onClick={onFound} className={`${btn} text-emerald-600 dark:text-emerald-400`}>Mark found</button>}
      {isAdmin && c.status === 'WITHDRAWN' && (
        <button type="button" onClick={onReinstate} className={`${btn} text-emerald-600 dark:text-emerald-400`}>Reinstate</button>
      )}
    </span>
  );
}
