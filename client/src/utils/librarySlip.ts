// Thermal-slip (80mm) printing. The generic part (printSlip) is reused by Phase 4 receipts.
import type { PaymentView } from "../hooks/useFines";

export interface SlipLine { label?: string; value: string; bold?: boolean; big?: boolean; center?: boolean }
export interface SlipData {
  title: string;                  // library name
  subtitle?: string[];            // campus / address lines
  heading?: string;               // e.g. "BOOK ISSUE SLIP"
  lines: SlipLine[];
  footer?: string[];
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function buildSlipHtml(d: SlipData): string {
  const lines = d.lines.map((l) => {
    const cls = ['row', l.bold ? 'b' : '', l.big ? 'big' : '', l.center ? 'c' : ''].join(' ');
    return l.label
      ? `<div class="${cls}"><span class="l">${escapeHtml(l.label)}</span><span class="v">${escapeHtml(l.value)}</span></div>`
      : `<div class="${cls}">${escapeHtml(l.value) || '&nbsp;'}</div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(d.heading || d.title)}</title>
<style>
@page { size: 80mm auto; margin: 4mm; }
* { box-sizing: border-box; }
body { margin: 0; width: 72mm; font-family: "Courier New", ui-monospace, monospace; font-size: 12px; color: #000; background: #fff; }
.c { text-align: center; } .b { font-weight: 700; } .big { font-size: 15px; }
.t { text-align: center; font-weight: 700; font-size: 14px; }
.s { text-align: center; font-size: 11px; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; word-break: break-word; }
.row .l { flex: 0 0 auto; } .row .v { text-align: right; }
.foot { text-align: center; font-size: 11px; margin-top: 2px; }
</style></head><body>
<div class="t">${escapeHtml(d.title)}</div>
${(d.subtitle || []).filter(Boolean).map((x) => `<div class="s">${escapeHtml(x)}</div>`).join('')}
<hr>${d.heading ? `<div class="t">${escapeHtml(d.heading)}</div><hr>` : ''}
${lines}
<hr>${(d.footer || []).map((x) => `<div class="foot">${escapeHtml(x)}</div>`).join('')}
</body></html>`;
}

/** Prints via a hidden iframe (no popup blockers). */
export function printSlip(d: SlipData) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) { iframe.remove(); return; }
  doc.open(); doc.write(buildSlipHtml(d)); doc.close();
  win.onafterprint = () => setTimeout(() => iframe.remove(), 500);
  setTimeout(() => {
    try { win.focus(); win.print(); } finally { setTimeout(() => iframe.remove(), 60000); }
  }, 150);
}

export function fmtYmd(ymd: string) {
  const [y, m, d] = (ymd || '').split('-');
  return y && m && d ? `${d}-${m}-${y}` : ymd;
}

export interface IssueSlip {
  campusName: string; libraryName: string; receiptAddress?: string;
  catalogNumber: string; title: string;
  studentName: string; regNumber: string; batch: string;
  issuedAt: string; dueDate: string; staffName: string;
}

export function printIssueSlip(s: IssueSlip) {
  const issued = new Date(s.issuedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  printSlip({
    title: s.libraryName || s.campusName,
    subtitle: [s.campusName, s.receiptAddress || ''],
    heading: 'BOOK ISSUE SLIP',
    lines: [
      { label: 'Student', value: s.studentName },
      { label: 'Reg No', value: s.regNumber },
      { label: 'Batch', value: s.batch || '-' },
      { value: '' },
      { label: 'Book', value: s.title },
      { label: 'Catalog', value: s.catalogNumber },
      { label: 'Issued', value: issued },
      { label: 'DUE DATE', value: fmtYmd(s.dueDate), bold: true, big: true },
      { label: 'Issued by', value: s.staffName },
    ],
    footer: ['Late fine applies after the due date.', 'Please return on time. Thank you.'],
  });
}

const CHARGE_LABEL = { LATE: 'Late', DAMAGE: 'Damage', LOST: 'Lost' } as const;

/** 80mm payment receipt. All values come from the server; nothing is computed here except display. */
export function printReceipt(p: PaymentView) {
  const when = new Date(p.receivedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const money = (n: number) => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const voided = !!p.voided;
  const lines: SlipLine[] = [];
  if (voided) lines.push({ value: '*** VOID ***', bold: true, big: true, center: true });
  lines.push(
    { label: 'Receipt', value: p.receiptNumber, bold: true },
    { label: 'Date', value: when },
    { label: 'Student', value: p.student.fullName },
    { label: 'Reg No', value: p.student.regNumber },
    { label: 'Batch', value: p.student.batch?.name || '-' },
    { value: '' },
  );
  p.allocations.forEach((a) => {
    const c = a.charge;
    const days = c.chargeableDays ?? c.daysLate;
    const type = c.type === 'LATE'
      ? `${CHARGE_LABEL.LATE}${days != null ? `: ${days} ${days === 1 ? 'day' : 'days'}` : ''}`
      : CHARGE_LABEL[c.type] || c.type;
    lines.push({ value: `${c.catalogNumber} - ${c.title}` });
    lines.push({ label: type, value: money(a.amount) });
    if (c.type === 'LATE' && (c.waivedDays ?? 0) > 0) lines.push({ value: `(${c.waivedDays} no-fine ${c.waivedDays === 1 ? 'day' : 'days'} excluded)` });
  });
  lines.push({ value: '' });
  lines.push({ label: 'TOTAL (cash)', value: money(p.amount), bold: true, big: true });
  lines.push({ label: 'Received by', value: p.receivedBy?.name || '-' });
  if (p.note) lines.push({ label: 'Note', value: p.note });
  const footer = ['Thank you.'];
  if (voided && p.voided) footer.unshift(`VOIDED ${new Date(p.voided.at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}: ${p.voided.reason}`);
  if (p.campus.openingHours) footer.unshift(`Hours: ${p.campus.openingHours}`);
  printSlip({
    title: p.campus.libraryName || p.campus.name,
    subtitle: [p.campus.name, p.campus.receiptAddress, p.campus.receiptPhone ? `Ph: ${p.campus.receiptPhone}` : ''],
    heading: voided ? 'PAYMENT RECEIPT (VOID)' : 'PAYMENT RECEIPT',
    lines, footer,
  });
}

export interface NoDuesSlip {
  libraryName: string; campusName?: string; receiptAddress?: string;
  studentName: string; regNumber: string; batch: string;
  reference: string; issuedAt: string; issuedBy: string;
}

/** 80mm No-Dues certificate. All values come from the server's slip response. */
export function printNoDuesSlip(s: NoDuesSlip) {
  const when = new Date(s.issuedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  printSlip({
    title: s.libraryName,
    subtitle: [s.campusName || '', s.receiptAddress || ''],
    heading: 'LIBRARY NO-DUES CERTIFICATE',
    lines: [
      { value: 'This is to certify that the student below has no books or fines pending with the library.', center: true },
      { value: '' },
      { label: 'Student', value: s.studentName, bold: true },
      { label: 'Reg No', value: s.regNumber },
      { label: 'Batch', value: s.batch || '-' },
      { value: '' },
      { label: 'Reference', value: s.reference, bold: true },
      { label: 'Date', value: when },
      { label: 'Issued by', value: s.issuedBy },
      { value: '' },
      { value: '' },
      { value: '______________________', center: true },
      { value: 'Librarian signature', center: true },
    ],
    footer: ['Valid as of the date and time above.'],
  });
}
