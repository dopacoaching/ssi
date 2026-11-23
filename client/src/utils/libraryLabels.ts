import jsPDF from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { headerStyle, rowStyle } from './exportUtils';
import type { BulkRow, BulkRowResult } from '../hooks/useCatalog';

// ── Label sheet (A4, 3 x 8 = 24 labels per page) ─────────────────────────────

export interface LabelItem { catalogNumber: string; title: string; campusCode: string }

const COLS = 3;
const ROWS = 8;
const PER_PAGE = COLS * ROWS;
const LABEL_W = 70;
const LABEL_H = 37;
const MARGIN_X = (210 - COLS * LABEL_W) / 2; // 0
const MARGIN_Y = (297 - ROWS * LABEL_H) / 2; // 0.5

// jsPDF's built-in Helvetica only covers Latin-1; anything else would print as garbage.
const isLatin1 = (s: string) => !/[^\u0000-\u00ff]/.test(s);

export function printLabelSheet(labels: LabelItem[], opts: { startAt?: number } = {}) {
  if (labels.length === 0) return;
  const startAt = Math.min(Math.max(Math.floor(opts.startAt || 1), 1), PER_PAGE);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let pos = startAt - 1; // slot index across the whole run
  labels.forEach((label, i) => {
    if (i > 0 && pos % PER_PAGE === 0) doc.addPage();
    const slot = pos % PER_PAGE;
    const col = slot % COLS;
    const row = Math.floor(slot / COLS);
    const x = MARGIN_X + col * LABEL_W;
    const y = MARGIN_Y + row * LABEL_H;
    const cx = x + LABEL_W / 2;

    // faint cut guide
    doc.setDrawColor(210);
    doc.setLineWidth(0.1);
    doc.rect(x + 1, y + 1, LABEL_W - 2, LABEL_H - 2);

    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(isLatin1(label.catalogNumber) ? label.catalogNumber : '', cx, y + 14, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const maxW = LABEL_W - 10;
    let lines: string[] = isLatin1(label.title) ? doc.splitTextToSize(label.title, maxW) : [];
    if (lines.length > 2) {
      lines = lines.slice(0, 2);
      let last = lines[1];
      while (last.length > 1 && doc.getTextWidth(last + '…') > maxW) last = last.slice(0, -1);
      lines[1] = last.trimEnd() + '…';
    }
    if (lines.length) doc.text(lines, cx, y + 21, { align: 'center', lineHeightFactor: 1.2 });

    doc.setFontSize(6);
    doc.setTextColor(120);
    if (isLatin1(label.campusCode)) doc.text(label.campusCode, cx, y + LABEL_H - 4, { align: 'center' });
    pos++;
  });

  const campus = (isLatin1(labels[0].campusCode) && labels[0].campusCode) || 'library';
  const date = new Date().toISOString().slice(0, 10);
  doc.save(`labels-${campus}-${date}.pdf`);
}

// ── Bulk upload template / parsing ───────────────────────────────────────────

const TEMPLATE_HEADERS = ['Title*', 'Author', 'Category', 'Shelf Location', 'Copies', 'Price', 'Publisher', 'Edition', 'Year', 'ISBN', 'Remarks'];

function styledSheet(headers: string[], rows: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const range = XLSX.utils.decode_range(ws['!ref'] as string);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) continue;
      ws[addr].s = r === 0 ? headerStyle(false) : rowStyle(r % 2 === 1, 'left');
    }
  }
  return ws;
}

export function downloadBulkTemplate() {
  const ws = styledSheet(TEMPLATE_HEADERS, [[
    'Concepts of Physics', 'H. C. Verma', 'Physics', 'Rack A1', 2, 450, 'Bharati Bhawan', '2nd', 2019, '9788177091878', 'Example row - delete before upload',
  ]]);
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(14, h.length + 4) }));
  ws['!cols'][0] = { wch: 34 };
  ws['!cols'][10] = { wch: 34 };

  const info = styledSheet(['Instructions'], [
    ['Fill one row per book title. Only Title is required.'],
    ['Copies: number of physical copies (1 to 200). Leave blank for 1. Each copy gets its own catalog number.'],
    ['Category and Shelf Location: pick an existing value or type a new one - new values are added to the library lists.'],
    ['Price: a number (0 or more). Year: a 4-digit year.'],
    ['Do not rename the column headers. Delete the example row before uploading.'],
    ['Up to 1000 rows per file.'],
  ]);
  info['!cols'] = [{ wch: 110 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Books');
  XLSX.utils.book_append_sheet(wb, info, 'Instructions');
  XLSX.writeFile(wb, 'library-books-template.xlsx');
}

const FIELD_MAP: Record<string, keyof BulkRow> = {
  title: 'title', author: 'author', category: 'category', shelflocation: 'shelfLocation', shelf: 'shelfLocation',
  copies: 'copies', price: 'price', publisher: 'publisher', edition: 'edition', year: 'year', isbn: 'isbn', remarks: 'remarks',
};

const RAW_FIELDS = new Set<keyof BulkRow>(['year', 'price', 'copies']);

function normHeader(h: unknown) {
  return String(h ?? '').toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]/g, '');
}

export async function parseBulkFile(file: File): Promise<BulkRow[]> {
  let wb: XLSX.WorkBook;
  try {
    if (/\.csv$/i.test(file.name)) {
      wb = XLSX.read((await file.text()).replace(/^\uFEFF/, ''), { type: 'string' });
    } else {
      wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    }
  } catch {
    throw new Error('Could not read this file. Use the template (.xlsx, .xls or .csv).');
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('The file has no sheets.');
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true, raw: true });
  // Formatted text (keeps ISBN leading zeros etc.) for text columns; raw for numeric ones.
  const textGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true, raw: false });

  const headerIdx = grid.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (headerIdx === -1) throw new Error('The file is empty.');
  const colFields = grid[headerIdx].map((h) => FIELD_MAP[normHeader(h)]);
  if (!colFields.includes('title')) throw new Error('No "Title" column found. Download the template and use its headers.');

  const rows: BulkRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells.some((c) => String(c ?? '').trim() !== '')) continue;
    const row: Record<string, unknown> = { rowNumber: i + 1, title: '' };
    colFields.forEach((f, c) => {
      if (!f) return;
      const v = RAW_FIELDS.has(f) ? cells[c] : (textGrid[i]?.[c] ?? cells[c]);
      if (v === undefined || v === null) return;
      row[f] = typeof v === 'string' ? v.trim() : v;
    });
    row.title = String(row.title ?? '').trim();
    rows.push(row as unknown as BulkRow);
  }
  if (rows.length === 0) throw new Error('No data rows found below the header.');
  return rows;
}

export function downloadErrorReport(rows: BulkRow[], results: BulkRowResult[]) {
  const byRow = new Map(results.map((r) => [r.rowNumber, r]));
  const bad = rows.filter((r) => (byRow.get(r.rowNumber)?.errors.length ?? 0) > 0);
  const headers = ['Row', ...TEMPLATE_HEADERS, 'Errors'];
  const data = bad.map((r) => [
    r.rowNumber, r.title, r.author ?? '', r.category ?? '', r.shelfLocation ?? '', r.copies ?? '', r.price ?? '',
    r.publisher ?? '', r.edition ?? '', r.year ?? '', r.isbn ?? '', r.remarks ?? '',
    (byRow.get(r.rowNumber)?.errors ?? []).join('; '),
  ] as (string | number)[]);
  const ws = styledSheet(headers, data);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, h.length + 4) }));
  ws['!cols'][headers.length - 1] = { wch: 60 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Errors');
  XLSX.writeFile(wb, 'library-upload-errors.xlsx');
}
