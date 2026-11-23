import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import ConfirmModal from '../../components/ConfirmModal';
import ReasonModal from '../../components/ReasonModal';
import { useLibrary } from '../../hooks/useLibrary';
import { useCatalog } from '../../hooks/useCatalog';
import { useStockCheck, type ScanResult, type StockCheckDetail as Detail } from '../../hooks/useStockCheck';
import { Banner } from '../../components/CirculationBits';
import { fmtDateTime, inputCls, labelCls, primaryBtn, ghostBtn, StatusChip } from '../../components/LibraryBits';
import { exportMissingCopiesExcel } from '../../utils/libraryExport';
import { SC_STATUS } from './StockCheck';

const card = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4';

const RESULT_STYLE: Record<ScanResult['result'], string> = {
  OK: 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200',
  ALREADY_SCANNED: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200',
  ISSUED: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200',
  DAMAGED: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200',
  LOST: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-900 dark:text-red-200',
  WITHDRAWN: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-900 dark:text-red-200',
  NOT_FOUND: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-900 dark:text-red-200',
  WRONG_CAMPUS: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-900 dark:text-red-200',
};

export default function StockCheckDetail() {
  const { id = '' } = useParams();
  const { me, fetchMe } = useLibrary();
  const sc = useStockCheck();
  const { markFound } = useCatalog();

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const [code, setCode] = useState('');
  const [last, setLast] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [closing, setClosing] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [foundFor, setFoundFor] = useState<{ copyId: string; catalogNumber: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [markingLost, setMarkingLost] = useState(false);
  const [lostResult, setLostResult] = useState<{ marked: number; skipped: { copyId: string; catalogNumber: string; status: string }[] } | null>(null);

  useEffect(() => { fetchMe().catch(() => {}); }, [fetchMe]);
  const isAdmin = !!me?.isAdmin;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { setData(await sc.get(id)); setError(''); setNotFound(false); }
    catch (e: any) {
      if (e.response?.status === 404) setNotFound(true);
      setError(e.response?.data?.message || 'Could not load the stock check');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const isOpen = data?.status === 'OPEN';
  useEffect(() => { if (isOpen) inputRef.current?.focus(); }, [isOpen]);

  const doScan = async () => {
    const n = code.trim().toUpperCase();
    if (!n || busy.current || !isOpen) return;
    busy.current = true; setScanning(true); setCode('');
    try {
      const r = await sc.scan(id, n);
      setLast(r);
      setData((d) => (d ? { ...d, scanCount: r.scanCount } : d));
      load(true);
    } catch (e: any) {
      setLast({ result: 'NOT_FOUND', message: e.response?.data?.message || 'Scan failed. Try again.', copy: null, scanCount: data?.scanCount ?? 0 });
    } finally { busy.current = false; setScanning(false); inputRef.current?.focus(); }
  };

  const undo = async (copyId: string, catalogNumber: string) => {
    try {
      await sc.undoScan(id, copyId);
      toast.success(`Scan of ${catalogNumber} undone`);
      if (last?.copy?.id === copyId) setLast(null);
      await load(true);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Could not undo the scan'); }
    inputRef.current?.focus();
  };

  const doClose = async () => {
    setCloseBusy(true);
    try { await sc.close(id); toast.success('Stock check closed'); setClosing(false); setLast(null); await load(); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Could not close the stock check'); }
    finally { setCloseBusy(false); }
  };

  const missing = data?.missing ?? [];
  const pendingMissing = missing.filter((m) => !m.markedLostAt);
  const toggle = (cid: string) => setSelected((s) => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  const allSelected = pendingMissing.length > 0 && pendingMissing.every((m) => selected.has(m.copyId));

  if (loading && !data) {
    return <Layout><div className="max-w-4xl mx-auto space-y-4">{[1, 2].map((n) => <div key={n} className="h-32 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}</div></Layout>;
  }
  if (!data) {
    return (
      <Layout><div className="max-w-4xl mx-auto space-y-3">
        <Link to="/library/stock-check" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">← Stock checks</Link>
        <Banner kind="error">{notFound ? 'Stock check not found.' : error || 'Could not load the stock check.'}</Banner>
        {!notFound && <button type="button" onClick={() => load()} className={primaryBtn}>Retry</button>}
      </div></Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <Link to="/library/stock-check" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">← Stock checks</Link>

        <div className={card}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{data.campus.name} stock check</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Started {fmtDateTime(data.startedAt)} by {data.startedBy?.name || '-'}{data.note ? ` · ${data.note}` : ''}
              </p>
              {data.status === 'CLOSED' && <p className="text-xs text-gray-500 dark:text-gray-400">Closed {data.closedAt ? fmtDateTime(data.closedAt) : ''} by {data.closedBy?.name || '-'}</p>}
              {data.status === 'CANCELLED' && <p className="text-xs text-gray-500 dark:text-gray-400">Cancelled {data.cancelledAt ? fmtDateTime(data.cancelledAt) : ''} by {data.cancelledBy?.name || '-'}: {data.cancelReason}</p>}
            </div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SC_STATUS[data.status]}`}>{data.status}</span>
          </div>
        </div>

        {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}

        {isOpen && (
          <>
            <div className={card}>
              <label className={labelCls} htmlFor="sc-code">Catalog Number</label>
              <input id="sc-code" ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doScan(); } }}
                className={`${inputCls} !text-xl !py-4 font-mono`} placeholder="Scan or type, press Enter" autoComplete="off" autoFocus />
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <p className="text-sm text-gray-700 dark:text-gray-200">Scanned: <span className="text-2xl font-bold">{data.scanCount}</span>{scanning && <span className="text-xs text-gray-400 ml-2">…</span>}</p>
                <div className="flex gap-2">
                  {isAdmin && <button type="button" onClick={() => setCancelling(true)} className={ghostBtn}>Cancel check</button>}
                  <button type="button" onClick={() => setClosing(true)} className={primaryBtn}>Close check</button>
                </div>
              </div>
            </div>

            {last && (
              <div role="status" className={`border-2 rounded-2xl p-4 ${RESULT_STYLE[last.result]}`}>
                <p className="text-lg font-bold">{last.result === 'OK' ? 'OK' : last.result.replace(/_/g, ' ')}</p>
                <p className="text-sm mt-0.5 break-words">
                  {last.copy && <><span className="font-mono">{last.copy.catalogNumber}</span> {last.copy.title} · </>}{last.message}
                </p>
                {last.result === 'LOST' && last.copy && (
                  <button type="button" onClick={() => setFoundFor({ copyId: last.copy!.id, catalogNumber: last.copy!.catalogNumber })}
                    className="mt-2 bg-white dark:bg-gray-800 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 px-3 py-1.5 rounded-lg text-sm font-medium">Mark found</button>
                )}
              </div>
            )}

            <div className={card}>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Shelf progress</p>
              {data.progress.length === 0 ? <p className="text-sm text-gray-400 dark:text-gray-500">No shelves yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                      <th className="py-2 pr-3 font-medium">Shelf</th><th className="py-2 pr-3 font-medium text-right">Expected</th>
                      <th className="py-2 pr-3 font-medium text-right">Scanned</th><th className="py-2 font-medium w-32">Progress</th>
                    </tr></thead>
                    <tbody>{data.progress.map((p) => {
                      const pct = p.expected > 0 ? Math.min(100, Math.round((p.scanned / p.expected) * 100)) : 100;
                      return (
                        <tr key={p.shelf || '-'} className="border-b border-gray-50 dark:border-gray-700/50 text-gray-800 dark:text-gray-100">
                          <td className="py-1.5 pr-3">{p.shelf || 'No shelf'}</td>
                          <td className="py-1.5 pr-3 text-right">{p.expected}</td>
                          <td className="py-1.5 pr-3 text-right font-semibold">{p.scanned}</td>
                          <td className="py-1.5"><div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700"><div className={`h-2 rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} /></div></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              )}
            </div>

            <div className={card}>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Recent scans</p>
              {data.recentScans.length === 0 ? <p className="text-sm text-gray-400 dark:text-gray-500">Nothing scanned yet.</p> : (
                <ul className="space-y-1.5">{data.recentScans.map((s) => (
                  <li key={s.copyId} className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-gray-50 dark:border-gray-700/50 pb-1.5">
                    <span className="min-w-0 break-words text-gray-800 dark:text-gray-100">
                      <span className="font-mono text-xs">{s.catalogNumber}</span> {s.title}
                      {s.statusAtScan !== 'AVAILABLE' && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">({s.statusAtScan.toLowerCase()})</span>}
                    </span>
                    <span className="flex gap-3 text-xs whitespace-nowrap">
                      {s.statusAtScan === 'LOST' && <button type="button" onClick={() => setFoundFor({ copyId: s.copyId, catalogNumber: s.catalogNumber })} className="text-emerald-600 dark:text-emerald-400 font-medium">Mark found</button>}
                      <button type="button" onClick={() => undo(s.copyId, s.catalogNumber)} className="text-red-600 dark:text-red-400 font-medium">Undo</button>
                    </span>
                  </li>))}
                </ul>
              )}
            </div>
          </>
        )}

        {data.status === 'CLOSED' && (
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Missing copies ({missing.length})</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{data.scanCount} scanned{data.expectedCount != null ? ` of ${data.expectedCount} expected` : ''}</p>
              </div>
              <div className="flex gap-2">
                {missing.length > 0 && <button type="button" onClick={() => exportMissingCopiesExcel(missing, `stock-check-missing-${data.campus.code}-${(data.closedAt || '').slice(0, 10)}.xlsx`)} className={ghostBtn}>Excel</button>}
                {pendingMissing.length > 0 && <button type="button" disabled={selected.size === 0} onClick={() => setMarkingLost(true)} className="px-4 py-2.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-xl font-medium disabled:opacity-60">Mark selected lost ({selected.size})</button>}
              </div>
            </div>
            {lostResult && (
              <div className="mb-3">
                <Banner kind={lostResult.skipped.length ? 'info' : 'success'} onClose={() => setLostResult(null)}>
                  <p className="font-semibold">{lostResult.marked} {lostResult.marked === 1 ? 'copy' : 'copies'} marked lost.</p>
                  {lostResult.skipped.length > 0 && <p className="mt-1">Skipped (no longer available): {lostResult.skipped.map((s) => `${s.catalogNumber} (${s.status.toLowerCase()})`).join(', ')}</p>}
                </Banner>
              </div>
            )}
            {missing.length === 0 ? <p className="text-sm text-gray-400 dark:text-gray-500">Nothing missing. Every available copy was scanned.</p> : (
              <>
                {pendingMissing.length > 0 && (
                  <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 mb-2 cursor-pointer">
                    <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(pendingMissing.map((m) => m.copyId)))} />
                    Select all ({pendingMissing.length})
                  </label>
                )}
                <ul className="divide-y divide-gray-50 dark:divide-gray-700/50 max-h-[60vh] overflow-y-auto">{missing.map((m) => (
                  <li key={m.copyId} className="py-2 flex items-start gap-3 text-sm">
                    <input type="checkbox" className="mt-1" disabled={!!m.markedLostAt} checked={selected.has(m.copyId)} onChange={() => toggle(m.copyId)} aria-label={`Select ${m.catalogNumber}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-800 dark:text-gray-100 break-words"><span className="font-mono text-xs">{m.catalogNumber}</span> {m.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Shelf: {m.shelfLocation || '-'}</p>
                    </div>
                    {m.markedLostAt && <StatusChip status="LOST" />}
                  </li>))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      <ConfirmModal open={closing} title="Close stock check"
        message={`Close this check with ${data.scanCount} scanned? Available copies that were not scanned will be listed as missing. You cannot scan more after closing.`}
        confirmLabel="Close check" loading={closeBusy} onConfirm={doClose} onCancel={() => setClosing(false)} />

      {cancelling && (
        <ReasonModal title="Cancel stock check" message="The scans are kept for the record, but nothing is marked missing." confirmLabel="Cancel check" danger
          onClose={() => setCancelling(false)}
          onSubmit={async (reason) => { await sc.cancel(id, reason); toast.success('Stock check cancelled'); setCancelling(false); await load(); }} />
      )}

      {foundFor && (
        <ReasonModal title={`Mark ${foundFor.catalogNumber} found`} message="The copy returns to Available. Charges already raised stay as they are."
          label="Note" required={false} confirmLabel="Mark found" onClose={() => setFoundFor(null)}
          onSubmit={async (note) => {
            await markFound(foundFor.copyId, note || undefined);
            toast.success(`${foundFor.catalogNumber} marked found`);
            setFoundFor(null); setLast(null); await load(true);
          }} />
      )}

      {markingLost && (
        <ReasonModal title={`Mark ${selected.size} ${selected.size === 1 ? 'copy' : 'copies'} lost`}
          message="No fine is charged to anyone. These copies leave circulation as Lost."
          confirmLabel="Mark lost" danger
          validate={() => (selected.size > 500 ? 'Select at most 500 copies at a time' : null)}
          onClose={() => setMarkingLost(false)}
          onSubmit={async (reason) => {
            const r = await sc.markLost(id, Array.from(selected), reason);
            setLostResult(r); setSelected(new Set()); setMarkingLost(false);
            await load(true);
          }} />
      )}
    </Layout>
  );
}
