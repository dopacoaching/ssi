import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import { useLibrary } from '../../hooks/useLibrary';
import { useCatalog, type BulkImportResult, type BulkRow, type BulkValidation } from '../../hooks/useCatalog';
import { downloadBulkTemplate, downloadErrorReport, parseBulkFile } from '../../utils/libraryLabels';
import { PrintLabelsPanel, inputCls, labelCls, primaryBtn, ghostBtn } from '../../components/LibraryBits';

const card = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5';

const TOO_LARGE = 'File is too large to upload in one go — split it into smaller files (max 1000 rows)';
const errMsg = (err: any, fallback: string) =>
  err.response?.status === 413 ? TOO_LARGE : err.response?.data?.message || err.message || fallback;

export default function BulkUpload() {
  const { me, fetchMe } = useLibrary();
  const { validateBulk, importBulk } = useCatalog();

  const [campusId, setCampusId] = useState('');
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [validation, setValidation] = useState<BulkValidation | null>(null);
  const [choices, setChoices] = useState<Record<number, string>>({}); // rowNumber -> 'new' | bookId
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  useEffect(() => {
    fetchMe().catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load library'));
  }, [fetchMe]);

  useEffect(() => {
    if (me?.isAdmin && !campusId && me.campuses.length === 1) setCampusId(me.campuses[0].id);
  }, [me, campusId]);

  const needCampus = !!me?.isAdmin;
  const effectiveCampus = needCampus ? campusId : undefined;
  const campusCode = me?.isAdmin ? me.campuses.find((c) => c.id === campusId)?.code : me?.campus?.code;

  const rowTitle = useMemo(() => new Map(rows.map((r) => [r.rowNumber, r])), [rows]);
  const errorCount = validation?.rows.filter((r) => r.errors.length > 0).length ?? 0;
  const unresolved = validation?.rows.filter((r) => r.duplicates.length > 0 && !choices[r.rowNumber]).length ?? 0;
  const canImport = !!validation && validation.valid && errorCount === 0 && unresolved === 0 && !importing;

  function resetFile() { setRows([]); setFileName(''); setValidation(null); setChoices({}); }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (needCampus && !campusId) { toast.error('Select a campus first'); return; }
    resetFile();
    setChecking(true);
    try {
      const parsed = await parseBulkFile(file);
      if (parsed.length > 1000) throw new Error('A file can have at most 1000 rows. Split it and upload in parts.');
      setRows(parsed); setFileName(file.name);
      const v = await validateBulk(effectiveCampus, parsed);
      setValidation(v);
      if (!v.valid && !v.rows.some((r) => r.errors.length > 0) && v.message) toast.error(v.message);
    } catch (err: any) {
      toast.error(errMsg(err, 'Failed to read file'));
      resetFile();
    } finally { setChecking(false); }
  }

  async function handleImport() {
    if (!validation) return;
    const payload: BulkRow[] = rows.map((r) => {
      const c = choices[r.rowNumber];
      return { ...r, resolution: c && c !== 'new' ? { mode: 'existing', bookId: c } : { mode: 'new' } };
    });
    setImporting(true);
    try {
      const r = await importBulk(effectiveCampus, payload);
      setResult(r);
      toast.success(`Imported ${r.copies.length} copies`);
      fetchMe().catch(() => {});
    } catch (err: any) {
      const data = err.response?.data?.data as BulkValidation | undefined;
      if (data?.rows) setValidation({ ...data, message: err.response?.data?.message });
      toast.error(errMsg(err, 'Import failed'));
    } finally { setImporting(false); }
  }

  const importLabels = useMemo(() => (result?.copies ?? []).map((c) => ({
    catalogNumber: c.catalogNumber, title: c.title, campusCode: campusCode || c.catalogNumber.split('-')[0],
  })), [result, campusCode]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <Link to="/library/catalog" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">← Catalog</Link>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mt-1">Bulk upload</h2>
        </div>

        {result ? (
          <div className="space-y-4">
            <div className={card}>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Import complete</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="New books" value={result.createdBooks} />
                <Stat label="Existing books topped up" value={result.addedToExisting} />
                <Stat label="Copies added" value={result.copies.length} />
                <Stat label="New categories / shelves" value={result.addedCategories.length + result.addedShelves.length} />
              </div>
            </div>
            <PrintLabelsPanel title={`${result.copies.length} new catalog numbers`} labels={importLabels} />
            <div className="flex gap-2">
              <Link to="/library/catalog" className={primaryBtn}>Go to catalog</Link>
              <button type="button" onClick={() => { setResult(null); resetFile(); }} className={ghostBtn}>Upload another file</button>
            </div>
          </div>
        ) : (
          <>
            <div className={`${card} space-y-4`}>
              {needCampus && (
                <div className="max-w-xs">
                  <label className={labelCls}>Campus *</label>
                  <select value={campusId} onChange={(e) => { setCampusId(e.target.value); resetFile(); }} className={inputCls}>
                    <option value="">Select campus…</option>
                    {me?.campuses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={downloadBulkTemplate} className={ghostBtn}>Download template</button>
                <label className={`${primaryBtn} cursor-pointer ${checking || (needCampus && !campusId) ? 'opacity-60 pointer-events-none' : ''}`}>
                  {checking ? 'Checking…' : fileName ? 'Choose a different file' : 'Choose file'}
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
                </label>
                {fileName && <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{fileName}</span>}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Accepted: .xlsx, .xls, .csv, up to 1000 rows. Only Title is required.</p>
            </div>

            {validation && (
              <>
                <div className={card}>
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Rows" value={validation.totalRows} />
                    <Stat label="Total copies" value={validation.totalCopies} />
                    <Stat label="Rows with errors" value={errorCount} danger={errorCount > 0} />
                  </div>
                  {validation.newCategories.length > 0 && (
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-3"><span className="font-medium">New categories:</span> {validation.newCategories.join(', ')}</p>
                  )}
                  {validation.newShelves.length > 0 && (
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-1"><span className="font-medium">New shelves:</span> {validation.newShelves.join(', ')}</p>
                  )}
                  {(validation.warnings || []).map((w, i) => (
                    <p key={i} className="text-xs text-amber-700 dark:text-amber-300 mt-3">{w}</p>
                  ))}
                  {!validation.valid && errorCount === 0 && validation.message && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-3">{validation.message}</p>
                  )}
                  {unresolved > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-3">{unresolved} possible {unresolved === 1 ? 'duplicate needs' : 'duplicates need'} a choice before importing.</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button type="button" disabled={!canImport} onClick={handleImport} className={primaryBtn}>
                      {importing ? 'Importing…' : `Import ${validation.totalCopies} copies`}
                    </button>
                    {errorCount > 0 && (
                      <button type="button" onClick={() => downloadErrorReport(rows, validation.rows)} className={ghostBtn}>Download error report</button>
                    )}
                    <button type="button" onClick={resetFile} className={ghostBtn}>Clear</button>
                  </div>
                </div>

                <div className="space-y-2">
                  {validation.rows.map((vr) => {
                    const r = rowTitle.get(vr.rowNumber);
                    const hasErr = vr.errors.length > 0;
                    return (
                      <div key={vr.rowNumber}
                        className={`bg-white dark:bg-gray-800 border rounded-2xl p-3 ${hasErr ? 'border-red-300 dark:border-red-800' : 'border-gray-200 dark:border-gray-700'}`}>
                        <div className="flex items-start gap-3">
                          <span className="text-xs font-mono text-gray-400 dark:text-gray-500 w-10 flex-shrink-0 pt-0.5">#{vr.rowNumber}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-100 break-words">{r?.title || <em className="text-gray-400">No title</em>}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {[r?.author, r?.category, r?.shelfLocation && `Shelf ${r.shelfLocation}`, `${r?.copies || 1} ${Number(r?.copies || 1) === 1 ? 'copy' : 'copies'}`].filter(Boolean).join(' · ')}
                            </p>
                            {hasErr && (
                              <ul className="mt-1 text-xs text-red-600 dark:text-red-400 list-disc pl-4">
                                {vr.errors.map((er, i) => <li key={i}>{er}</li>)}
                              </ul>
                            )}
                            {(vr.warnings || []).length > 0 && (
                              <ul className="mt-1 text-xs text-amber-700 dark:text-amber-300 list-disc pl-4">
                                {(vr.warnings || []).map((w, i) => <li key={i}>{w}</li>)}
                              </ul>
                            )}
                            {vr.duplicateInFile.length > 0 && (
                              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Same title and author also in row{vr.duplicateInFile.length > 1 ? 's' : ''} {vr.duplicateInFile.join(', ')} of this file.</p>
                            )}
                            {vr.duplicates.length > 0 && (
                              <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5">
                                <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">Already in this library. Choose:</p>
                                <select value={choices[vr.rowNumber] ?? ''} onChange={(e) => setChoices((c) => ({ ...c, [vr.rowNumber]: e.target.value }))}
                                  className={inputCls} aria-label={`Resolution for row ${vr.rowNumber}`}>
                                  <option value="">Select…</option>
                                  {vr.duplicates.map((d) => (
                                    <option key={d.id} value={d.id}>Add copies to existing: {d.title} ({d.copyCount} {d.copyCount === 1 ? 'copy' : 'copies'})</option>
                                  ))}
                                  <option value="new">Create as new book</option>
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>{value}</p>
    </div>
  );
}
