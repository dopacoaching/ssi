import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import { useLibrary } from '../../hooks/useLibrary';
import { useCirculation, type LoanView, type ReportLostResult, type StudentCard, type StudentHistory } from '../../hooks/useCirculation';
import { inputCls, labelCls, primaryBtn, CampusPill } from '../../components/LibraryBits';
import { Banner, StudentSummary, OtherCampusLine, WaivedDaysNote, conditionLabel, fmtDay, fmtYmd, money } from '../../components/CirculationBits';
import { fmtDateTime } from '../../components/LibraryBits';
import CollectPaymentModal from '../../components/CollectPaymentModal';
import ReportLostModal, { LostResultBanner } from '../../components/ReportLostModal';
import WaiverRequestModal from '../../components/WaiverRequestModal';
import { printReceipt } from '../../utils/librarySlip';
import type { ChargeView } from '../../hooks/useCirculation';

const card = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5';
const CHARGE_STYLE: Record<string, string> = {
  UNPAID: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  PARTIAL: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  PAID: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  WAIVED: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export default function StudentLibrary() {
  const { regNumber = '' } = useParams();
  const { me, fetchMe } = useLibrary();
  const { getStudentCard, getStudentHistory } = useCirculation();

  const [campusId, setCampusId] = useState('');
  const [data, setData] = useState<{ card: StudentCard; history: StudentHistory } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [waiving, setWaiving] = useState<ChargeView | null>(null);
  const [lostLoan, setLostLoan] = useState<LoanView | null>(null);
  const [lostResult, setLostResult] = useState<ReportLostResult | null>(null);

  useEffect(() => {
    fetchMe().then((m) => { if (m.isAdmin) setCampusId((c) => c || m.campuses[0]?.id || ''); })
      .catch((e: any) => { setError(e.response?.data?.message || 'Failed to load library'); setLoading(false); });
  }, [fetchMe]);

  const isAdmin = !!me?.isAdmin;
  const waitingCampus = isAdmin && !campusId;

  useEffect(() => {
    if (!me || waitingCampus) return;
    let live = true;
    setLoading(true); setError('');
    getStudentCard(regNumber, isAdmin ? campusId : undefined)
      .then(async (c) => {
        const h = await getStudentHistory(c.student.id);
        if (live) setData({ card: c, history: h });
      })
      .catch((e: any) => {
        if (!live) return;
        setData(null);
        const msg = e.response?.data?.message || 'Could not load student';
        setError(msg); toast.error(msg);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [me, waitingCampus, isAdmin, campusId, regNumber, getStudentCard, getStudentHistory, retry]);

  const past = data?.history.loans.filter((l) => l.status !== 'OPEN') ?? [];
  const charges = data?.history.charges ?? [];
  const payments = data?.history.payments ?? [];
  const waivers = data?.history.waivers ?? [];
  const payable = charges.filter((c) => c.balance > 0);
  const waiveBtn = (c: ChargeView) => c.balance > 0 && (
    <button type="button" onClick={() => setWaiving(c)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">{isAdmin ? 'Waive' : 'Request waiver'}</button>
  );

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Student library record</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono">{regNumber}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link to={`/library/clearance?reg=${encodeURIComponent(regNumber)}`} className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">No-Dues</Link>
            <Link to="/library/desk" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">Back to desk</Link>
          </div>
        </div>

        {isAdmin && me && (
          <div className={card}>
            <label className={labelCls} htmlFor="sl-campus">Campus</label>
            <select id="sl-campus" value={campusId} onChange={(e) => setCampusId(e.target.value)} className={`${inputCls} sm:w-72`}>
              {me.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {loading && <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-28 bg-gray-100 dark:bg-gray-700 rounded-2xl animate-pulse" />)}</div>}

        {!loading && error && (
          <div className="space-y-3">
            <Banner kind="error">{error}</Banner>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className={primaryBtn}>Retry</button>
          </div>
        )}

        {!loading && data && (
          <>
            <StudentSummary card={data.card} showEligibility={false} onReportLost={(l) => setLostLoan(l)} />
            {lostResult && <LostResultBanner result={lostResult} onClose={() => setLostResult(null)} onCollect={() => { setLostResult(null); setCollecting(true); }} />}

            <div className={card}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Charges</p>
                {payable.length > 0 && <button type="button" onClick={() => setCollecting(true)} className={primaryBtn}>Collect payment</button>}
              </div>
              {charges.length === 0 ? <p className="text-sm text-gray-400 dark:text-gray-500">No charges.</p> : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                        <th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Book</th>
                        <th className="py-2 pr-3 font-medium text-right">Amount</th><th className="py-2 pr-3 font-medium text-right">Balance</th>
                        <th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 font-medium"></th>
                      </tr></thead>
                      <tbody>{charges.map((c) => (
                        <tr key={c.id} className="border-b border-gray-50 dark:border-gray-700/50 text-gray-800 dark:text-gray-100">
                          <td className="py-2 pr-3">{c.type === 'LATE' ? 'Late fine' : c.type === 'DAMAGE' ? 'Damage' : 'Lost'}</td>
                          <td className="py-2 pr-3"><span className="font-mono text-xs">{c.copy.catalogNumber}</span> {c.book.title}</td>
                          <td className="py-2 pr-3 text-right">{money(c.amount)}</td>
                          <td className="py-2 pr-3 text-right font-semibold">{money(c.balance)}</td>
                          <td className="py-2 pr-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CHARGE_STYLE[c.status]}`}>{c.status}</span></td>
                          <td className="py-2 pr-3 text-xs text-gray-500 dark:text-gray-400">{fmtDay(c.createdAt)}</td>
                          <td className="py-2 text-right whitespace-nowrap">{waiveBtn(c)}</td>
                        </tr>))}</tbody>
                    </table>
                  </div>
                  <div className="md:hidden space-y-2">{charges.map((c) => (
                    <div key={c.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium text-gray-800 dark:text-gray-100">{c.type === 'LATE' ? 'Late fine' : c.type === 'DAMAGE' ? 'Damage' : 'Lost'}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CHARGE_STYLE[c.status]}`}>{c.status}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{c.copy.catalogNumber} {c.book.title}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">Amount {money(c.amount)} · Balance <span className="font-semibold">{money(c.balance)}</span> · {fmtDay(c.createdAt)}</p>
                      {c.balance > 0 && <div className="mt-2">{waiveBtn(c)}</div>}
                    </div>))}
                  </div>
                </>
              )}
            </div>

            <div className={card}>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Past loans</p>
              {past.length === 0 ? <p className="text-sm text-gray-400 dark:text-gray-500">No past loans.</p> : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                        <th className="py-2 pr-3 font-medium">Book</th><th className="py-2 pr-3 font-medium">Issued</th>
                        <th className="py-2 pr-3 font-medium">Due</th><th className="py-2 pr-3 font-medium">Returned</th>
                        <th className="py-2 pr-3 font-medium text-right">Days late</th><th className="py-2 pr-3 font-medium text-right">Fine</th>
                        <th className="py-2 font-medium">Condition</th>
                      </tr></thead>
                      <tbody>{past.map((l) => (
                        <tr key={l.id} className="border-b border-gray-50 dark:border-gray-700/50 text-gray-800 dark:text-gray-100 align-top">
                          <td className="py-2 pr-3"><span className="font-mono text-xs">{l.copy.catalogNumber}</span> <Link to={`/library/books/${l.book.id}`} className="hover:underline">{l.book.title}</Link>
                            {l.status === 'LOST' && <> <LostBadge l={l} /></>}
                            {isAdmin && <> <CampusPill code={l.campus.code} /></>}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtDay(l.issuedAt)}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtYmd(l.dueDate)}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{l.status === 'LOST' ? <span className="text-red-600 dark:text-red-300">Lost {fmtDay(l.lostAt)}</span> : fmtDay(l.returnedAt)}</td>
                          <td className="py-2 pr-3 text-right">{l.daysLate}{(l.waivedDays ?? 0) > 0 && <div><WaivedDaysNote days={l.waivedDays!} /></div>}</td>
                          <td className={`py-2 pr-3 text-right ${l.lateFine > 0 ? 'text-red-600 dark:text-red-300 font-semibold' : ''}`}>{money(l.lateFine)}</td>
                          <td className="py-2 text-xs">{conditionLabel(l.condition)}</td>
                        </tr>))}</tbody>
                    </table>
                  </div>
                  <div className="md:hidden space-y-2">{past.map((l) => (
                    <div key={l.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 text-sm">
                      <p className="font-medium text-gray-800 dark:text-gray-100 break-words"><span className="font-mono text-xs">{l.copy.catalogNumber}</span> {l.book.title}{l.status === 'LOST' && <> <LostBadge l={l} /></>}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{fmtDay(l.issuedAt)} to {l.status === 'LOST' ? `lost ${fmtDay(l.lostAt)}` : fmtDay(l.returnedAt)} (due {fmtYmd(l.dueDate)})</p>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{l.daysLate} days late · fine {money(l.lateFine)} · {conditionLabel(l.condition)}</p>
                      {(l.waivedDays ?? 0) > 0 && <p className="mt-1"><WaivedDaysNote days={l.waivedDays!} /></p>}
                    </div>))}
                  </div>
                </>
              )}
            </div>

            <div className={card}>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Payments</p>
              {payments.length === 0 ? <p className="text-sm text-gray-400 dark:text-gray-500">No payments.</p> : (
                <div className="space-y-2">{payments.map((p) => (
                  <div key={p.id} className={`border border-gray-100 dark:border-gray-700 rounded-xl p-3 text-sm flex flex-wrap items-center justify-between gap-2 ${p.voided ? 'opacity-60' : ''}`}>
                    <div className="min-w-0">
                      <p className="text-gray-800 dark:text-gray-100"><span className="font-mono text-xs">{p.receiptNumber}</span> · <span className={`font-semibold ${p.voided ? 'line-through' : ''}`}>{money(p.amount)}</span>
                        {p.voided && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">VOID</span>}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{fmtDateTime(p.receivedAt)} · {p.receivedBy?.name || '—'}{p.voided ? ` · voided: ${p.voided.reason}` : ''}</p>
                    </div>
                    <button type="button" onClick={() => printReceipt(p)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">Reprint</button>
                  </div>))}
                </div>
              )}
            </div>

            <div className={card}>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Waivers</p>
              {waivers.length === 0 ? <p className="text-sm text-gray-400 dark:text-gray-500">No waivers.</p> : (
                <div className="space-y-2">{waivers.map((w) => (
                  <div key={w.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 text-sm">
                    <p className="text-gray-800 dark:text-gray-100">
                      {money(w.status === 'APPROVED' ? w.approvedAmount ?? w.amount : w.amount)} · {w.charge.type === 'LATE' ? 'Late fine' : w.charge.type === 'DAMAGE' ? 'Damage' : 'Lost'} <span className="font-mono text-xs">{w.charge.copy.catalogNumber}</span>
                      <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">{w.status}</span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 break-words">{w.reason} · {w.requestedBy?.name || '—'} · {fmtDateTime(w.requestedAt)}</p>
                  </div>))}
                </div>
              )}
            </div>

            <OtherCampusLine o={data.history.otherCampuses} />
          </>
        )}
      </div>
      {collecting && data && (
        <CollectPaymentModal studentId={data.card.student.id} campusId={isAdmin ? campusId : undefined}
          onClose={() => { setCollecting(false); setRetry((n) => n + 1); }} onDone={() => { /* refreshed on close */ }} />
      )}
      {lostLoan && (
        <ReportLostModal loan={lostLoan} isAdmin={isAdmin} onClose={() => setLostLoan(null)}
          onDone={(r) => { setLostLoan(null); setLostResult(r); setRetry((n) => n + 1); }} />
      )}
      {waiving && (
        <WaiverRequestModal charge={waiving} isAdmin={isAdmin} onClose={() => setWaiving(null)}
          onDone={() => { setWaiving(null); setRetry((n) => n + 1); }} />
      )}
    </Layout>
  );
}

function LostBadge({ l }: { l: LoanView }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
      Lost{l.foundAt ? ` · found ${fmtDay(l.foundAt)}` : ''}
    </span>
  );
}
