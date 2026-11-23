import * as XLSX from 'xlsx-js-style';
import { headerStyle, rowStyle } from './exportUtils';
import type { LoanView } from '../hooks/useCirculation';
import type { PendingFineItem, PaymentView } from '../hooks/useFines';

export function exportLoansExcel(loans: LoanView[], viewLabel: string, filename: string) {
  const headers = ['Student', 'Reg Number', 'Batch', 'Campus', 'Catalog No.', 'Title', 'Issued', 'Due Date', 'Days Late', 'Fine (INR)'];
  const aligns: ('left' | 'center' | 'right')[] = ['left', 'left', 'left', 'center', 'left', 'left', 'center', 'center', 'center', 'right'];
  const rows = loans.map((l) => [
    l.student.fullName, l.student.regNumber, l.student.batch?.name || '', l.campus.code,
    l.copy.catalogNumber, l.book.title,
    new Date(l.issuedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }), l.dueDate, l.daysLate, l.lateFine,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const widths = [24, 14, 16, 8, 14, 36, 12, 12, 10, 10];
  ws['!cols'] = widths.map((wch) => ({ wch }));
  ws['!rows'] = [{ hpt: 28 }, ...rows.map(() => ({ hpt: 18 }))];
  headers.forEach((_, c) => {
    const h = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (h) h.s = headerStyle(true);
  });
  rows.forEach((_, r) => headers.forEach((__, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r: r + 1, c })];
    if (cell) cell.s = rowStyle(r % 2 === 0, aligns[c]);
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, viewLabel.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

function sheetOut(headers: string[], aligns: ('left' | 'center' | 'right')[], widths: number[], rows: (string | number)[][], sheetName: string, filename: string) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = widths.map((wch) => ({ wch }));
  ws['!rows'] = [{ hpt: 28 }, ...rows.map(() => ({ hpt: 18 }))];
  headers.forEach((_, c) => {
    const h = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (h) h.s = headerStyle(true);
  });
  rows.forEach((_, r) => headers.forEach((__, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r: r + 1, c })];
    if (cell) cell.s = rowStyle(r % 2 === 0, aligns[c]);
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

export function exportPendingFinesExcel(items: PendingFineItem[], filename: string) {
  sheetOut(
    ['Student', 'Reg Number', 'Batch', 'Campus', 'Pending (INR)', 'Charges', 'Accruing (INR)', 'Oldest Charge'],
    ['left', 'left', 'left', 'center', 'right', 'center', 'right', 'center'],
    [26, 14, 16, 8, 14, 9, 14, 14],
    items.map((i) => [
      i.student.fullName, i.student.regNumber, i.student.batch?.name || '', i.campus.code, i.balance, i.chargeCount, i.accruing,
      i.oldestChargeAt ? new Date(i.oldestChargeAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
    ]),
    'Pending fines', filename,
  );
}

export function exportPaymentsExcel(items: PaymentView[], filename: string) {
  sheetOut(
    ['Receipt No.', 'Date & Time', 'Campus', 'Student', 'Reg Number', 'Batch', 'Amount (INR)', 'Received By', 'Status', 'Void Reason', 'Note'],
    ['left', 'center', 'center', 'left', 'left', 'left', 'right', 'left', 'center', 'left', 'left'],
    [16, 20, 8, 24, 14, 16, 13, 18, 9, 24, 24],
    items.map((p) => [
      p.receiptNumber, new Date(p.receivedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), p.campus.code,
      p.student.fullName, p.student.regNumber, p.student.batch?.name || '', p.amount, p.receivedBy?.name || '',
      p.voided ? 'VOID' : 'OK', p.voided?.reason || '', p.note || '',
    ]),
    'Payments', filename,
  );
}

/* ───────────────────────── Generic report exporters ───────────────────────── */
import type { ReportColumn, ReportResult } from '../hooks/useReports';

/** DD-MM-YYYY from a YYYY-MM-DD string or an ISO timestamp (IST). */
export function fmtReportDate(v: string | number | null | undefined): string {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-'); return `${d}-${m}-${y}`; }
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return s;
  const [y, m, d] = dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).split('-');
  return `${d}-${m}-${y}`;
}

const inr = (n: number, symbol: string) =>
  `${symbol}${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Display text for a cell. `symbol` is '₹' on screen / Excel text, 'Rs. ' in PDF (jsPDF core fonts have no rupee glyph). */
export function fmtReportCell(col: ReportColumn, v: string | number | null | undefined, symbol = '₹'): string {
  if (v == null || v === '') return '';
  if (col.type === 'money') return inr(Number(v), symbol);
  if (col.type === 'date') return fmtReportDate(v);
  if (col.type === 'number') return Number(v).toLocaleString('en-IN');
  return String(v);
}

function reportHeaderLines(r: ReportResult): string[] {
  const range = r.from || r.to ? `Period: ${r.from ? fmtReportDate(r.from) : 'start'} to ${r.to ? fmtReportDate(r.to) : 'today'}` : '';
  return [
    r.title,
    `Campus: ${r.campus ? `${r.campus.name} (${r.campus.code})` : 'All campuses'}`,
    range,
    `Generated: ${new Date(r.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    r.truncated ? 'Note: rows truncated to the first 5,000.' : '',
  ].filter(Boolean);
}

export function exportReportExcel(r: ReportResult, filename: string) {
  const head = reportHeaderLines(r);
  const hasTotals = !!r.totals && Object.keys(r.totals).length > 0;
  const nCols = r.columns.length;
  const aoa: (string | number)[][] = head.map((h) => [h]);
  aoa.push([]);
  const headerRow = aoa.length;
  aoa.push(r.columns.map((c) => c.label));
  r.rows.forEach((row) => aoa.push(r.columns.map((c) => {
    const v = row[c.key];
    if (v == null) return '';
    if (c.type === 'date') return fmtReportDate(v);
    if (c.type === 'number' || c.type === 'money') return Number.isFinite(Number(v)) ? Number(v) : String(v);
    return v;
  })));
  const totalsRow = aoa.length;
  if (hasTotals) {
    aoa.push(r.columns.map((c, i) => (i === 0 && r.totals![c.key] === undefined ? 'Total' : r.totals![c.key] ?? '')));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = r.columns.map((c) => {
    const longest = r.rows.slice(0, 200).reduce((m, row) => Math.max(m, fmtReportCell(c, row[c.key]).length), c.label.length);
    return { wch: Math.min(Math.max(longest + 2, 10), 48) };
  });
  ws['!merges'] = head.map((_, i) => ({ s: { r: i, c: 0 }, e: { r: i, c: Math.max(nCols - 1, 0) } }));
  head.forEach((_, i) => {
    const cell = ws[XLSX.utils.encode_cell({ r: i, c: 0 })];
    if (cell) cell.s = { font: { bold: i === 0, sz: i === 0 ? 14 : 10, name: 'Calibri' }, alignment: { horizontal: 'left' } };
  });
  r.columns.forEach((_, c) => {
    const h = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (h) h.s = headerStyle(true);
  });
  const alignOf = (t: ReportColumn['type']): 'left' | 'center' | 'right' => (t === 'text' ? 'left' : t === 'date' ? 'center' : 'right');
  const applyRow = (rIdx: number, even: boolean, bold: boolean) => r.columns.forEach((c, ci) => {
    const addr = XLSX.utils.encode_cell({ r: rIdx, c: ci });
    const cell = ws[addr] ?? (ws[addr] = { t: 's', v: '' });
    cell.s = rowStyle(even, alignOf(c.type), bold);
    if (c.type === 'money' && typeof cell.v === 'number') cell.z = '"₹"#,##0.00';
  });
  r.rows.forEach((_, i) => applyRow(headerRow + 1 + i, i % 2 === 0, false));
  if (hasTotals) {
    applyRow(totalsRow, true, true);
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalsRow, c: Math.max(nCols - 1, 0) } });
  }
  ws['!rows'] = [{ hpt: 22 }];
  ws['!freeze'] = { xSplit: 0, ySplit: headerRow + 1 } as any;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, r.title.replace(/[\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  XLSX.writeFile(wb, filename);
}

export async function exportReportPDF(r: ReportResult, filename: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: r.columns.length > 7 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const head = reportHeaderLines(r);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(15, 23, 42);
  doc.text(head[0], 14, 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  head.slice(1).forEach((l, i) => doc.text(l, 14, 22 + i * 4.5));
  const startY = 22 + (head.length - 1) * 4.5 + 3;

  const hasTotals = !!r.totals && Object.keys(r.totals).length > 0;
  const align = (t: ReportColumn['type']) => (t === 'text' ? 'left' : t === 'date' ? 'center' : 'right') as 'left' | 'center' | 'right';
  const body = r.rows.map((row) => r.columns.map((c) => fmtReportCell(c, row[c.key], 'Rs. ')));
  const foot = hasTotals
    ? [r.columns.map((c, i) => (i === 0 && r.totals![c.key] === undefined ? 'Total' : r.totals![c.key] === undefined ? '' : fmtReportCell(c, r.totals![c.key], 'Rs. ')))]
    : undefined;
  const columnStyles: Record<number, { halign: 'left' | 'center' | 'right' }> = {};
  r.columns.forEach((c, i) => { columnStyles[i] = { halign: align(c.type) }; });

  autoTable(doc, {
    startY,
    head: [r.columns.map((c) => c.label)],
    body, foot,
    showFoot: 'lastPage',
    headStyles: { fillColor: [15, 23, 42], fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8.5 },
    columnStyles,
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240], tableLineWidth: 0.2,
    margin: { left: 14, right: 14 },
  });
  doc.save(filename);
}

export function exportMissingCopiesExcel(
  items: { catalogNumber: string; title: string; shelfLocation: string; markedLostAt: string | null }[],
  filename: string,
) {
  sheetOut(
    ['Catalog No.', 'Title', 'Shelf', 'Marked Lost'],
    ['left', 'left', 'left', 'center'],
    [16, 44, 16, 14],
    items.map((m) => [m.catalogNumber, m.title, m.shelfLocation || '', m.markedLostAt ? fmtReportDate(m.markedLostAt) : '']),
    'Missing copies', filename,
  );
}
