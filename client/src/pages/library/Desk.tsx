import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import type { RootState } from '../../store';
import Layout from '../../components/Layout';
import { useLibrary } from '../../hooks/useLibrary';
import {
  useCirculation, reasonsFrom,
  type CopyCard, type IssueResult, type LoanView, type Reason, type ReportLostResult, type ReturnResult, type StudentCard,
} from '../../hooks/useCirculation';
import { StatusChip, inputCls, labelCls, primaryBtn, ghostBtn } from '../../components/LibraryBits';
import { Banner, OverdueChip, WaivedDaysNote, StudentSummary, money, fmtDay, fmtYmd } from '../../components/CirculationBits';
import { printIssueSlip } from '../../utils/librarySlip';
import CollectPaymentModal from '../../components/CollectPaymentModal';
import ReportLostModal, { LostResultBanner } from '../../components/ReportLostModal';
import { BackdateControl, backdatePayload, noBackdate, type Backdate } from '../../components/Backdate';

const TAB_KEY = 'library.desk.tab';
type Tab = 'issue' | 'return';
const bigInput = `${inputCls} !text-lg !py-3 font-mono`;
const card = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4';

function loadTab(): Tab {
  try { return localStorage.getItem(TAB_KEY) === 'return' ? 'return' : 'issue'; } catch { return 'issue'; }
}

export default function Desk() {
  const user = useSelector((s: RootState) => s.auth.user);
  const { me, fetchMe } = useLibrary();
  const [sp] = useSearchParams();
  const qReg = sp.get('reg') || '';
  const qCat = sp.get('catalog') || '';
  const [tab, setTab] = useState<Tab>(() => (qReg ? 'issue' : qCat ? 'return' : loadTab()));
  const [deskCampus, setDeskCampus] = useState('');
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetchMe().catch((e: any) => { setLoadError(true); toast.error(e.response?.data?.message || 'Failed to load library'); });
  }, [fetchMe]);

  const changeTab = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ }
  };

  const isAdmin = !!me?.isAdmin;
  const campusId = isAdmin ? deskCampus : me?.campus?.id || '';
  const ready = !!me && (!isAdmin || !!deskCampus);
  const campus = me?.campuses.find((c) => c.id === campusId) || me?.campus || null;

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" onClick={() => changeTab(t)} aria-pressed={tab === t}
      className={`px-5 py-2.5 rounded-xl text-sm font-medium ${tab === t ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700'}`}>
      {label}
    </button>
  );

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Library Desk</h2>
            {!isAdmin && campus && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{campus.name}</p>}
          </div>
          <div className="flex gap-2">{tabBtn('issue', 'Issue')}{tabBtn('return', 'Return / Renew')}</div>
        </div>

        {isAdmin && me && (
          <div className={card}>
            <label className={labelCls} htmlFor="desk-campus">Desk campus (required)</label>
            <select id="desk-campus" value={deskCampus} onChange={(e) => setDeskCampus(e.target.value)} className={inputCls}>
              <option value="">Select campus…</option>
              {me.campuses.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {loadError ? (
          <Banner kind="error">Could not load the library. Refresh the page to retry.</Banner>
        ) : !me ? (
          <div className="h-40 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />
        ) : !ready ? (
          <Banner kind="info">Select a desk campus to start.</Banner>
        ) : tab === 'issue' ? (
          <IssuePanel key={campusId} initialReg={qReg} campusId={campusId} isAdmin={isAdmin} campusInfo={campus} staffName={user?.name || ''} />
        ) : (
          <ReturnPanel key={campusId} initialCat={qCat} campusId={campusId} isAdmin={isAdmin} />
        )}
      </div>
    </Layout>
  );
}

/* ───────────────────────────── Issue ───────────────────────────── */

function IssuePanel({ campusId, isAdmin, campusInfo, staffName, initialReg }: {
  initialReg?: string;
  campusId: string; isAdmin: boolean;
  campusInfo: { name: string; libraryName: string; receiptAddress: string } | null; staffName: string;
}) {
  const { getStudentCard, getCopyCard, issueBook } = useCirculation();
  const regRef = useRef<HTMLInputElement>(null);
  const catRef = useRef<HTMLInputElement>(null);

  const [reg, setReg] = useState('');
  const [student, setStudent] = useState<StudentCard | null>(null);
  const [loadingStudent, setLoadingStudent] = useState(false);
  const [cat, setCat] = useState('');
  const [preview, setPreview] = useState<CopyCard | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState('');
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const [backdate, setBackdate] = useState<Backdate>(noBackdate);
  const [collecting, setCollecting] = useState(false);
  const [lostLoan, setLostLoan] = useState<LoanView | null>(null);
  const [lostResult, setLostResult] = useState<ReportLostResult | null>(null);

  const issuingRef = useRef(false);

  useEffect(() => {
    if (initialReg) { setReg(initialReg); lookupStudent(initialReg); } else regRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetMessages = () => { setError(''); setReasons([]); setIssued(null); };

  const refreshCard = useCallback(async (regNumber: string) => {
    try { setStudent(await getStudentCard(regNumber, campusId)); } catch { /* keep current card */ }
  }, [getStudentCard, campusId]);

  const lookupStudent = async (override?: string) => {
    const r = (override ?? reg).trim();
    if (!r || loadingStudent) return;
    resetMessages(); setStudent(null); setPreview(null); setCat('');
    setBackdate(noBackdate); // never carry a backdate over to another student
    setLoadingStudent(true);
    try {
      const c = await getStudentCard(r, campusId);
      setStudent(c);
      if (c.eligibility.canIssue) setTimeout(() => catRef.current?.focus(), 0);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load student');
      regRef.current?.select();
    } finally { setLoadingStudent(false); }
  };

  const confirmIssue = useCallback(async (catalogNumber: string) => {
    if (!student || issuingRef.current) return;
    const bd = backdatePayload(backdate, 'issuedAt');
    if ('error' in bd) { setError(bd.error); return; }
    if (backdate.on) {
      const loanDays = student.settings.loanDays;
      const issuedDay = istYmd(new Date(backdate.at));
      if (addDaysYmd(issuedDay, loanDays) < istYmd(new Date())) {
        if (!window.confirm(`This backdated issue (${fmtYmd(issuedDay)}) would already be overdue. Issue anyway?`)) return;
      }
    }
    issuingRef.current = true;
    setIssuing(true); setError(''); setReasons([]);
    const regNumber = student.student.regNumber;
    try {
      const r = await issueBook({ regNumber, catalogNumber, campusId, ...bd.fields });
      setIssued(r); setPreview(null); setCat('');
      setBackdate(noBackdate);
      const card = r.student ?? await getStudentCard(regNumber, campusId).catch(() => null);
      if (card) setStudent(card);
      const full = !card || card.settings.maxBooks - card.loans.length <= 0 || !card.eligibility.canIssue;
      setTimeout(() => {
        if (full) { setReg(''); regRef.current?.focus(); }
        // Same student can take another book: go straight to the catalog box.
        // The Reg box selects-all on focus, so a new student's scan replaces the old number.
        else { catRef.current?.focus(); }
      }, 0);
    } catch (e: any) {
      const rs = reasonsFrom(e);
      setReasons(rs);
      setError(rs.length ? '' : e.response?.data?.message || 'Could not issue the book');
      setPreview(null);
      catRef.current?.select();
      if (rs.length) await refreshCard(regNumber);
    } finally { issuingRef.current = false; setIssuing(false); }
  }, [student, backdate, issueBook, getStudentCard, refreshCard, campusId]);

  const onCatEnter = async () => {
    const n = cat.trim().toUpperCase();
    if (!n || issuing || previewing) return;
    if (preview && preview.copy.catalogNumber.toUpperCase() === n) {
      if (preview.copy.status === 'AVAILABLE') await confirmIssue(preview.copy.catalogNumber);
      return;
    }
    resetMessages(); setPreview(null);
    setPreviewing(true);
    try { setPreview(await getCopyCard(n, campusId)); }
    catch (e: any) { setError(e.response?.data?.message || 'Copy not found'); catRef.current?.select(); }
    finally { setPreviewing(false); }
  };

  const slip = () => {
    if (!issued) return;
    const l = issued.loan;
    printIssueSlip({
      campusName: campusInfo?.name || l.campus.name, libraryName: campusInfo?.libraryName || '',
      receiptAddress: campusInfo?.receiptAddress,
      catalogNumber: l.copy.catalogNumber, title: l.book.title,
      studentName: l.student.fullName, regNumber: l.student.regNumber, batch: l.student.batch?.name || '',
      issuedAt: l.issuedAt, dueDate: l.dueDate, staffName: l.issuedBy?.name || staffName,
    });
  };

  const eligible = !!student?.eligibility.canIssue;
  const canConfirm = !!preview && preview.copy.status === 'AVAILABLE' && !issuing;

  return (
    <div className="space-y-4">
      <div className={card}>
        <label className={labelCls} htmlFor="desk-reg">Student Reg Number</label>
        <div className="flex gap-2">
          <input id="desk-reg" ref={regRef} value={reg} onChange={(e) => setReg(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookupStudent(); } }}
            className={bigInput} placeholder="Scan or type, press Enter" autoComplete="off" autoFocus />
          <button type="button" onClick={() => lookupStudent()} disabled={loadingStudent || !reg.trim()} className={primaryBtn}>
            {loadingStudent ? '…' : 'Load'}
          </button>
        </div>
      </div>

      {(error || reasons.length > 0) && <Banner kind="error" onClose={() => { setError(''); setReasons([]); }}>
        {error && <p className="font-medium">{error}</p>}
        {reasons.length > 0 && <ul className="list-disc pl-5 mt-1 space-y-0.5">{reasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul>}
      </Banner>}

      {loadingStudent && <div className="h-32 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />}

      {student && <StudentSummary card={student} onCollect={() => setCollecting(true)} onReportLost={(l) => setLostLoan(l)} />}
      {lostResult && <LostResultBanner result={lostResult} onClose={() => setLostResult(null)} onCollect={() => { setLostResult(null); setCollecting(true); }} />}
      {lostLoan && (
        <ReportLostModal loan={lostLoan} isAdmin={isAdmin} onClose={() => setLostLoan(null)}
          onDone={(r) => { setLostLoan(null); setLostResult(r); refreshCard(lostLoan.student.regNumber); }} />
      )}
      {collecting && student && (
        <CollectPaymentModal studentId={student.student.id} campusId={campusId}
          onClose={() => { setCollecting(false); refreshCard(student.student.regNumber); }}
          onDone={() => { refreshCard(student.student.regNumber); }} />
      )}
      {student && (
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
          <Link to={`/library/students/${student.student.regNumber}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">Full library record</Link>
        </p>
      )}

      {issued && (
        <Banner kind="success">
          <p className="font-semibold">Issued {issued.loan.copy.catalogNumber} "{issued.loan.book.title}" to {issued.loan.student.fullName}</p>
          <p className="mt-0.5">Due date: <span className="font-semibold">{fmtYmd(issued.loan.dueDate)}</span></p>
          {!issued.student && <p className="text-xs mt-1 opacity-80">Issued. Refreshing the student card…</p>}
          <button type="button" onClick={slip} className={`${primaryBtn} mt-3`}>Print slip</button>
        </Banner>
      )}

      {student && eligible && (
        <div className={`${card} space-y-3`}>
          <div>
            <label className={labelCls} htmlFor="desk-cat">Catalog Number</label>
            <input id="desk-cat" ref={catRef} value={cat}
              onChange={(e) => { setCat(e.target.value); setPreview(null); setError(''); setReasons([]); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCatEnter(); } }}
              className={bigInput} placeholder="e.g. IG1-00012, Enter to preview, Enter again to issue" autoComplete="off" />
          </div>

          {backdate.on && (
            <div role="alert" className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm font-semibold">
              BACKDATED to {backdate.at ? new Date(backdate.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '(choose a date)'} — reason: {backdate.reason.trim() || '(required)'}
            </div>
          )}

          {previewing && <div className="h-16 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />}
          {preview && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 break-words">{preview.book.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-mono">{preview.copy.catalogNumber}</span>{preview.book.author ? ` · ${preview.book.author}` : ''}
                </p>
                {preview.copy.status === 'ISSUED' && preview.openLoan && (
                  <p className="text-xs text-red-600 dark:text-red-300 mt-1">Already issued to {preview.openLoan.student.fullName}, due {fmtYmd(preview.openLoan.dueDate)}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <StatusChip status={preview.copy.status} />
                <button type="button" disabled={!canConfirm} onClick={() => confirmIssue(preview.copy.catalogNumber)} className={primaryBtn}>
                  {issuing ? 'Issuing…' : 'Issue'}
                </button>
              </div>
            </div>
          )}

          {isAdmin && <BackdateControl value={backdate} onChange={setBackdate} label="Issued at" />}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Return / Renew ─────────────────────────── */

function ReturnPanel({ campusId, isAdmin, initialCat }: { campusId: string; isAdmin: boolean; initialCat?: string }) {
  const { getCopyCard, returnBook, renewLoan } = useCirculation();
  const catRef = useRef<HTMLInputElement>(null);

  const [cat, setCat] = useState('');
  const [copy, setCopy] = useState<CopyCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<ReturnResult | null>(null);
  const [collectFor, setCollectFor] = useState<string | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostRes, setLostRes] = useState<ReportLostResult | null>(null);

  const [condition, setCondition] = useState<'GOOD' | 'DAMAGED'>('GOOD');
  const [severity, setSeverity] = useState<'MINOR' | 'MAJOR'>('MINOR');
  const [charge, setCharge] = useState('');
  const [backdate, setBackdate] = useState<Backdate>(noBackdate);

  useEffect(() => {
    if (initialCat) { setCat(initialCat); lookup(initialCat); } else catRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => { setCondition('GOOD'); setSeverity('MINOR'); setCharge(''); setBackdate(noBackdate); };

  const lookup = async (override?: string) => {
    const n = (override ?? cat).trim().toUpperCase();
    if (!n || loading) return;
    setError(''); setNotice(''); setResult(null); setCopy(null); resetForm();
    setLoading(true);
    try { setCopy(await getCopyCard(n, campusId)); }
    catch (e: any) { setError(e.response?.data?.message || 'Copy not found'); catRef.current?.select(); }
    finally { setLoading(false); }
  };

  const next = () => { setCat(''); setCopy(null); resetForm(); setTimeout(() => catRef.current?.focus(), 0); };

  const price = copy?.book.price ?? null;
  const suggested = price != null ? String(Math.round(price * 25) / 100) : '';
  const chargeNum = charge.trim() === '' ? NaN : Number(charge);
  const pickSeverity = (s: 'MINOR' | 'MAJOR') => {
    setSeverity(s);
    setCharge(s === 'MAJOR' ? (price != null ? String(price) : '') : suggested);
  };

  const doReturn = async () => {
    if (!copy?.openLoan || busyRef.current) return;
    const bd = backdatePayload(backdate, 'returnedAt');
    if ('error' in bd) { setError(bd.error); return; }
    const payload: Parameters<typeof returnBook>[0] = { catalogNumber: copy.copy.catalogNumber, condition, ...bd.fields };
    if (condition === 'DAMAGED') {
      payload.severity = severity;
      const n = charge.trim() === '' ? NaN : Number(charge);
      if (severity === 'MINOR' && (isNaN(n) || n < 0)) { setError('Enter the damage charge for minor damage (0 is allowed)'); return; }
      if (severity === 'MAJOR' && price == null && (isNaN(n) || n < 0)) { setError('Enter the damage charge (book price is unknown)'); return; }
      if (!isNaN(n)) { if (n < 0) { setError('Charge cannot be negative'); return; } payload.charge = n; }
    }
    busyRef.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await returnBook(payload);
      setResult(r); next();
    } catch (e: any) { setError(e.response?.data?.message || 'Could not return the book'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const doRenew = async () => {
    if (!copy?.openLoan || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setResult(null);
    try {
      const r = await renewLoan(copy.openLoan.id);
      setNotice(r.loan?.dueDate ? `Renewed. New due date ${fmtYmd(r.loan.dueDate)}.` : 'Renewed.');
      try { setCopy(await getCopyCard(copy.copy.catalogNumber, campusId)); } catch { /* keep card */ }
    } catch (e: any) { setError(e.response?.data?.message || 'Could not renew'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const loan = copy?.openLoan || null;

  return (
    <div className="space-y-4">
      <div className={card}>
        <label className={labelCls} htmlFor="ret-cat">Catalog Number</label>
        <div className="flex gap-2">
          <input id="ret-cat" ref={catRef} value={cat} onChange={(e) => setCat(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }}
            className={bigInput} placeholder="Scan or type, press Enter" autoComplete="off" autoFocus />
          <button type="button" onClick={() => lookup()} disabled={loading || !cat.trim()} className={primaryBtn}>{loading ? '…' : 'Find'}</button>
        </div>
      </div>

      {error && <Banner kind="error" onClose={() => setError('')}>{error}</Banner>}
      {notice && <Banner kind="success" onClose={() => setNotice('')}>{notice}</Banner>}

      {result && (
        <Banner kind="success" onClose={() => setResult(null)}>
          <p className="font-semibold">Returned {result.loan.copy.catalogNumber} "{result.loan.book.title}" {result.student ? `from ${result.student.fullName}` : ''}</p>
          {result.charges && result.student ? (
            <p className="mt-1">
              Fine created: <span className="font-semibold">{money(result.charges.filter((c) => c.type === 'LATE').reduce((s, c) => s + c.amount, 0))}</span>
              {' · '}Damage charge: <span className="font-semibold">{money(result.charges.filter((c) => c.type === 'DAMAGE').reduce((s, c) => s + c.amount, 0))}</span>
              {' · '}Student's outstanding: <span className="font-semibold">{money(result.student.outstanding)}</span>
            </p>
          ) : <p className="mt-1">Returned. Fine and charge details are not available yet; check the student's library record.</p>}
          {result.student && result.charges && result.charges.length > 0 && (
            <button type="button" onClick={() => setCollectFor(result.student!.id)} className={`${primaryBtn} mt-3`}>Collect now</button>
          )}
        </Banner>
      )}

      {lostOpen && loan && copy && (
        <ReportLostModal loan={loan} price={copy.book.price} isAdmin={isAdmin} onClose={() => setLostOpen(false)}
          onDone={(r) => { setLostOpen(false); setLostRes(r); next(); }} />
      )}
      {lostRes && <LostResultBanner result={lostRes} onClose={() => setLostRes(null)} onCollect={() => { if (lostRes.student) setCollectFor(lostRes.student.id); setLostRes(null); }} />}
      {collectFor && (
        <CollectPaymentModal studentId={collectFor} campusId={campusId || undefined}
          onClose={() => setCollectFor(null)} onDone={() => { /* receipt prints from the modal */ }} />
      )}

      {loading && <div className="h-40 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />}

      {copy && (
        <div className={`${card} space-y-4`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link to={`/library/books/${copy.book.id}`} className="text-base font-semibold text-gray-800 dark:text-gray-100 hover:underline break-words">{copy.book.title}</Link>
              <p className="text-xs text-gray-500 dark:text-gray-400"><span className="font-mono">{copy.copy.catalogNumber}</span>{copy.book.author ? ` · ${copy.book.author}` : ''}</p>
            </div>
            <StatusChip status={copy.copy.status} />
          </div>

          {!loan ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">This copy is not currently issued, so there is nothing to return.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="col-span-2">
                  <dt className="text-xs text-gray-400 dark:text-gray-500">Student</dt>
                  <dd><Link to={`/library/students/${loan.student.regNumber}`} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">{loan.student.fullName}</Link>
                    <span className="text-gray-500 dark:text-gray-400"> · <span className="font-mono">{loan.student.regNumber}</span>{loan.student.batch ? ` · ${loan.student.batch.name}` : ''}</span></dd>
                </div>
                <div><dt className="text-xs text-gray-400 dark:text-gray-500">Issued</dt><dd className="text-gray-800 dark:text-gray-100">{fmtDay(loan.issuedAt)}</dd></div>
                <div><dt className="text-xs text-gray-400 dark:text-gray-500">Due</dt><dd className="text-gray-800 dark:text-gray-100">{fmtYmd(loan.dueDate)} {loan.isOverdue && <OverdueChip />}</dd></div>
                <div><dt className="text-xs text-gray-400 dark:text-gray-500">Days late</dt><dd className="text-gray-800 dark:text-gray-100">{loan.daysLate}{(loan.waivedDays ?? 0) > 0 && <div><WaivedDaysNote days={loan.waivedDays!} /></div>}</dd></div>
                <div><dt className="text-xs text-gray-400 dark:text-gray-500">Fine</dt><dd className={loan.lateFine > 0 ? 'font-semibold text-red-600 dark:text-red-300' : 'text-gray-800 dark:text-gray-100'}>{money(loan.lateFine)}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-gray-400 dark:text-gray-500">Renewal</dt>
                  <dd className="text-gray-800 dark:text-gray-100">{loan.canRenew ? 'Can be renewed' : loan.renewBlockedReason || 'Cannot be renewed'}</dd></div>
              </dl>

              <fieldset className="space-y-2">
                <legend className={labelCls}>Condition on return</legend>
                <div className="flex gap-4">
                  {(['GOOD', 'DAMAGED'] as const).map((c) => (
                    <label key={c} className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                      <input type="radio" name="cond" checked={condition === c} onChange={() => { setCondition(c); setCharge(c === 'GOOD' ? '' : severity === 'MINOR' ? suggested : price != null ? String(price) : ''); }} />
                      {c === 'GOOD' ? 'Good' : 'Damaged'}
                    </label>
                  ))}
                </div>
                {condition === 'DAMAGED' && (
                  <div className="grid sm:grid-cols-2 gap-3 pt-1">
                    <div className="flex gap-4 items-center">
                      {(['MINOR', 'MAJOR'] as const).map((s) => (
                        <label key={s} className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                          <input type="radio" name="sev" checked={severity === s} onChange={() => pickSeverity(s)} />
                          {s === 'MINOR' ? 'Minor' : 'Major'}
                        </label>
                      ))}
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="ret-charge">
                        Damage charge (₹){severity === 'MAJOR' && price != null ? ` · book price ${money(price)}` : ''}
                      </label>
                      <input id="ret-charge" type="number" min={0} step="0.01" value={charge} onChange={(e) => setCharge(e.target.value)} className={inputCls} />
                      {severity === 'MINOR' && price != null && !isNaN(chargeNum) && chargeNum > Number(suggested) && (
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">Above the suggested 25% of price ({money(Number(suggested))})</p>
                      )}
                      {severity === 'MAJOR' && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">The copy will be withdrawn from circulation.</p>}
                    </div>
                  </div>
                )}
              </fieldset>

              {isAdmin && <BackdateControl value={backdate} onChange={setBackdate} label="Returned at" />}

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={doReturn} disabled={busy} className={primaryBtn}>{busy ? 'Working…' : 'Return'}</button>
                <button type="button" onClick={doRenew} disabled={busy || !loan.canRenew} className={ghostBtn}
                  title={loan.canRenew ? '' : loan.renewBlockedReason || 'Cannot be renewed'}>Renew</button>
                {!loan.canRenew && loan.renewBlockedReason && <span className="text-xs text-gray-500 dark:text-gray-400">{loan.renewBlockedReason}</span>}
                <button type="button" onClick={() => setLostOpen(true)} disabled={busy} className="text-sm font-medium text-red-600 dark:text-red-400 hover:underline">Report lost</button>
                <button type="button" onClick={next} className="text-sm text-gray-500 dark:text-gray-400 hover:underline ml-auto">Clear</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const istYmd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
/** Display-only warning helper; never used for fines. */
function addDaysYmd(ymd: string, n: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
