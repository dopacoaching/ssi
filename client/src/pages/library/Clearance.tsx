import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import { useLibrary } from '../../hooks/useLibrary';
import { useClearance, type ClearanceResult, type DueCharge, type DueLoan } from '../../hooks/useClearance';
import { inputCls, labelCls, primaryBtn, CampusPill } from '../../components/LibraryBits';
import { Avatar, Banner, OtherCampusLine, money, fmtYmd } from '../../components/CirculationBits';
import { printNoDuesSlip } from '../../utils/librarySlip';

const card = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4';
const typeLabel = (t: DueCharge['type']) => (t === 'LATE' ? 'Late fine' : t === 'DAMAGE' ? 'Damage' : 'Lost book');

export function DueItems({ loans, charges, showCampus }: { loans: DueLoan[]; charges: DueCharge[]; showCampus?: boolean }) {
  return (
    <div className="space-y-3">
      {loans.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Books not returned ({loans.length})</p>
          <ul className="space-y-1.5">{loans.map((l) => (
            <li key={l.loanId} className="text-sm text-gray-800 dark:text-gray-100 break-words">
              <span className="font-mono text-xs">{l.catalogNumber}</span> {l.title}
              {showCampus && <> <CampusPill code={l.campus.code} /></>}
              <span className={`block text-xs ${l.isOverdue ? 'text-red-600 dark:text-red-300 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                Due {fmtYmd(l.dueDate)}{l.isOverdue ? ` · ${l.daysLate} ${l.daysLate === 1 ? 'day' : 'days'} overdue · fine ${money(l.lateFine)}` : ''}
              </span>
            </li>))}
          </ul>
        </div>
      )}
      {charges.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Unpaid charges ({charges.length})</p>
          <ul className="space-y-1.5">{charges.map((c) => (
            <li key={c.chargeId} className="text-sm text-gray-800 dark:text-gray-100 break-words flex flex-wrap justify-between gap-x-3">
              <span>{typeLabel(c.type)}: <span className="font-mono text-xs">{c.catalogNumber}</span> {c.title}{showCampus && <> <CampusPill code={c.campus.code} /></>}</span>
              <span className="font-semibold">{money(c.balance)}</span>
            </li>))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Clearance() {
  const [sp] = useSearchParams();
  const { me, fetchMe } = useLibrary();
  const { getClearance, issueSlip } = useClearance();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reg, setReg] = useState(sp.get('reg') || '');
  const [result, setResult] = useState<ClearanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { fetchMe().catch(() => {}); }, [fetchMe]);

  const check = async (override?: string) => {
    const r = (override ?? reg).trim();
    if (!r || loading) return;
    setError(''); setNotice(''); setResult(null); setLoading(true);
    try { setResult(await getClearance(r)); }
    catch (e: any) { setError(e.response?.data?.message || 'Could not check this student'); inputRef.current?.select(); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const q = sp.get('reg');
    if (q) check(q); else inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const print = async () => {
    if (!result || printing) return;
    setPrinting(true); setError(''); setNotice('');
    try {
      const s = await issueSlip(result.student.regNumber);
      const c = s.campus || me?.campus;
      printNoDuesSlip({
        libraryName: c?.libraryName || c?.name || s.campus?.name || 'Library',
        campusName: c?.libraryName ? c.name : undefined,
        receiptAddress: c?.receiptAddress,
        studentName: s.student.fullName, regNumber: s.student.regNumber, batch: s.student.batch?.name || '',
        reference: s.reference, issuedAt: s.issuedAt, issuedBy: s.issuedBy?.name || '',
      });
      setNotice(`Slip ${s.reference} sent to the printer.`);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not print the slip');
      check(result.student.regNumber); // dues may have changed; refresh the view
    } finally { setPrinting(false); }
  };

  const isAdmin = !!me?.isAdmin;
  const s = result?.student;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">No-Dues check</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Checks books and fines across all campuses. Works for inactive students too.</p>
        </div>

        <div className={card}>
          <label className={labelCls} htmlFor="nd-reg">Student Reg Number</label>
          <div className="flex gap-2">
            <input id="nd-reg" ref={inputRef} value={reg} onChange={(e) => setReg(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } }}
              className={`${inputCls} !text-lg !py-3 font-mono`} placeholder="Type and press Enter" autoComplete="off" />
            <button type="button" onClick={() => check()} disabled={loading || !reg.trim()} className={primaryBtn}>{loading ? '…' : 'Check'}</button>
          </div>
        </div>

        {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}
        {notice && <Banner kind="success" onClose={() => setNotice('')}>{notice}</Banner>}
        {loading && <div className="h-32 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />}

        {result && s && !loading && (
          <>
            <div className={`${card} flex items-center gap-3`}>
              <Avatar name={s.fullName} photo={s.photo} />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-gray-800 dark:text-gray-100 break-words">{s.fullName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400"><span className="font-mono">{s.regNumber}</span> · {s.batch?.name || 'No batch'}{!s.isActive ? ' · Inactive' : ''}</p>
              </div>
              <Link to={`/library/students/${encodeURIComponent(s.regNumber)}`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">Library record</Link>
            </div>

            {result.isClear ? (
              <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-5 space-y-3">
                <p className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">No dues</p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300">No books on loan and no unpaid charges in any campus.</p>
                <button type="button" onClick={print} disabled={printing} className={primaryBtn}>{printing ? 'Preparing…' : 'No dues, print slip'}</button>
              </div>
            ) : (
              <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-5 space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-lg font-semibold text-red-700 dark:text-red-300">Pending dues</p>
                  <p className="text-sm text-red-700 dark:text-red-300">Outstanding: <span className="font-bold">{money(result.outstanding)}</span></p>
                </div>
                {(result.thisCampus.openLoans.length > 0 || result.thisCampus.charges.length > 0) && (
                  <div>
                    {!isAdmin && <p className="text-xs font-semibold text-red-800 dark:text-red-200 mb-2">This campus</p>}
                    <DueItems loans={result.thisCampus.openLoans} charges={result.thisCampus.charges} showCampus={isAdmin} />
                  </div>
                )}
                <OtherCampusLine o={result.otherCampuses} />
                <p className="text-xs text-red-700 dark:text-red-300">A slip cannot be printed until all dues are cleared.</p>
              </div>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Checked {new Date(result.checkedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} by {result.checkedBy?.name}
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
