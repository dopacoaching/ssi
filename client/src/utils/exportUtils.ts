import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface WeeklyRow  { weekDate: string; testType: string; subject: string; chapter?: string; marks: number; maxMarks: number; createdAt: string; }
export interface MonthlyRow { month: number; year: number; testType: string; subject: string; marks: number; maxMarks: number; createdAt: string; }
export interface StudentRow {
  regNumber: string;
  fullName: string;
  batchName: string;
}
export interface BatchReportStudent {
  id: string;
  regNumber: string;
  fullName: string;
  batch: { name: string };
  weeklyTests:  { weekDate: string; testType: string; subject: string; chapter?: string; marks: number; maxMarks: number; createdAt: string }[];
  monthlyTests: { month: number; year: number; testType: string; subject: string; marks: number; maxMarks: number; createdAt: string }[];
  ceRecords:    { month: number; year: number; theoryScore: number; mcqScore: number; attendScore: number; notesScore: number; totalCE: number; createdAt: string }[];
}

export interface CERow {
  month: number; year: number;
  physicsMarks: number; physicsMax: number;
  chemMarks: number;    chemMax: number;
  mathMarks: number;    mathMax: number;
  bioMarks: number;     bioMax: number;
  lang1Marks: number;   lang1Max: number;
  lang2Marks: number;   lang2Max: number;
  psychologyMarks: number;     psychologyMax: number;
  computerScienceMarks: number; computerScienceMax: number;
  mcqPct: number; attendancePct: number;
  hasMedCert: boolean; notesStatus: string;
  theoryScore: number; mcqScore: number;
  attendScore: number; notesScore: number; totalCE: number;
  createdAt: string;
}

// ── Excel Color Constants ─────────────────────────────────────────────────────
// ARGB format (Alpha + RGB hex)
const C = {
  INDIGO_700:  'FF3730A3',
  SLATE_900:   'FF0F172A',
  SLATE_800:   'FF1E293B',
  SLATE_600:   'FF475569',
  SLATE_50:    'FFF8FAFC',
  WHITE:       'FFFFFFFF',
  INDIGO_50:   'FFEEF2FF',
  INDIGO_100:  'FFE0E7FF',
  EMERALD_100: 'FFD1FAE5',
  EMERALD_700: 'FF047857',
  AMBER_100:   'FFFEF3C7',
  AMBER_700:   'FFB45309',
  RED_100:     'FFFEE2E2',
  RED_700:     'FFB91C1C',
  BORDER:      'FFE2E8F0',
  BORDER_MED:  'FFCBD5E1',
};

// ── Excel Styling Helpers ─────────────────────────────────────────────────────

function headerStyle(center = true): XLSX.CellStyle {
  return {
    font:      { bold: true, color: { rgb: C.WHITE }, sz: 10, name: 'Calibri' },
    fill:      { fgColor: { rgb: C.SLATE_900 }, patternType: 'solid' },
    alignment: { horizontal: center ? 'center' : 'left', vertical: 'center', wrapText: true },
    border:    { top: { style: 'thin', color: { rgb: C.BORDER_MED } }, bottom: { style: 'medium', color: { rgb: C.BORDER_MED } }, left: { style: 'thin', color: { rgb: C.BORDER_MED } }, right: { style: 'thin', color: { rgb: C.BORDER_MED } } },
  };
}

function rowStyle(isEven: boolean, align: 'left' | 'center' | 'right' = 'left', bold = false): XLSX.CellStyle {
  return {
    font:      { bold, color: { rgb: C.SLATE_800 }, sz: 9.5, name: 'Calibri' },
    fill:      { fgColor: { rgb: isEven ? C.WHITE : C.SLATE_50 }, patternType: 'solid' },
    alignment: { horizontal: align, vertical: 'center' },
    border:    { top: { style: 'thin', color: { rgb: C.BORDER } }, bottom: { style: 'thin', color: { rgb: C.BORDER } }, left: { style: 'thin', color: { rgb: C.BORDER } }, right: { style: 'thin', color: { rgb: C.BORDER } } },
  };
}

function ceScoreStyle(score: number, isEven: boolean): XLSX.CellStyle {
  let fg: string;
  let fc: string;
  if (score >= 15)      { fg = C.EMERALD_100; fc = C.EMERALD_700; }
  else if (score >= 10) { fg = C.AMBER_100;   fc = C.AMBER_700;   }
  else                  { fg = C.RED_100;     fc = C.RED_700;     }
  return {
    font:      { bold: true, color: { rgb: fc }, sz: 9.5, name: 'Calibri' },
    fill:      { fgColor: { rgb: fg }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center' },
    border:    { top: { style: 'thin', color: { rgb: C.BORDER } }, bottom: { style: 'thin', color: { rgb: C.BORDER } }, left: { style: 'thin', color: { rgb: C.BORDER } }, right: { style: 'thin', color: { rgb: C.BORDER } } },
  };
}

function pctStyle(pct: number, isEven: boolean): XLSX.CellStyle {
  let fc = C.SLATE_800;
  if (pct >= 80)      fc = C.EMERALD_700;
  else if (pct >= 50) fc = C.AMBER_700;
  else                fc = C.RED_700;
  return {
    font:      { bold: true, color: { rgb: fc }, sz: 9.5, name: 'Calibri' },
    fill:      { fgColor: { rgb: isEven ? C.WHITE : C.SLATE_50 }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center' },
    border:    { top: { style: 'thin', color: { rgb: C.BORDER } }, bottom: { style: 'thin', color: { rgb: C.BORDER } }, left: { style: 'thin', color: { rgb: C.BORDER } }, right: { style: 'thin', color: { rgb: C.BORDER } } },
  };
}

function sumRowStyle(align: 'left' | 'center' | 'right' = 'center'): XLSX.CellStyle {
  return {
    font:      { bold: true, color: { rgb: C.WHITE }, sz: 10, name: 'Calibri' },
    fill:      { fgColor: { rgb: C.INDIGO_700 }, patternType: 'solid' },
    alignment: { horizontal: align, vertical: 'center' },
    border:    { top: { style: 'medium', color: { rgb: C.BORDER_MED } }, bottom: { style: 'medium', color: { rgb: C.BORDER_MED } }, left: { style: 'thin', color: { rgb: C.BORDER_MED } }, right: { style: 'thin', color: { rgb: C.BORDER_MED } } },
  };
}

function applyAutoWidth(ws: XLSX.WorkSheet, rows: any[]) {
  if (!rows || rows.length === 0) return;
  const cols = Object.keys(rows[0]).map((key) => {
    const lengths = rows.map((r) => (r[key] != null ? r[key].toString().length : 0));
    const maxLen = Math.max(key.length + 3, ...lengths);
    return { wch: Math.min(maxLen + 2, 40) };
  });
  ws['!cols'] = cols;
}

function setRowHeight(ws: XLSX.WorkSheet, rowCount: number, headerHeight = 28, bodyHeight = 18) {
  ws['!rows'] = [{ hpt: headerHeight }, ...Array(rowCount).fill({ hpt: bodyHeight })];
}

function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

// Apply styles to a worksheet. headerCols specifies per-column alignment for header.
// colorRules: { colIndex, getValue } – applies CE-score or percentage coloring per cell.
type ColorRule =
  | { type: 'ce';  colIndex: number }
  | { type: 'pct'; colIndex: number };

function applyStyles(
  ws: XLSX.WorkSheet,
  dataRows: any[],
  options?: {
    firstColLeft?: boolean;
    colorRules?: ColorRule[];
    hasSumRow?: boolean;
    hasSumRowFirst?: boolean;
  }
) {
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const { firstColLeft = false, colorRules = [], hasSumRow = false, hasSumRowFirst = false } = options ?? {};

  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C2 = range.s.c; C2 <= range.e.c; ++C2) {
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C2 });
      if (!ws[cellRef]) {
        ws[cellRef] = { t: 's', v: '' };
      }
      const cell = ws[cellRef];

      if (R === 0) {
        // Header row
        cell.s = headerStyle(!(firstColLeft && C2 === 0));
      } else {
        const isSumRow = (hasSumRow && R === range.e.r) || (hasSumRowFirst && R === 1);
        const isEven = R % 2 === 1; // row 1 = first data row = even appearance

        if (isSumRow) {
          const align = firstColLeft && C2 === 0 ? 'left' : 'center';
          cell.s = sumRowStyle(align);
          continue;
        }

        // Check color rules
        const ceRule  = colorRules.find((r) => r.type === 'ce'  && r.colIndex === C2);
        const pctRule = colorRules.find((r) => r.type === 'pct' && r.colIndex === C2);

        if (ceRule) {
          const score = parseFloat(String(cell.v ?? 0));
          cell.s = ceScoreStyle(isNaN(score) ? 0 : score, isEven);
        } else if (pctRule) {
          const raw = String(cell.v ?? '').replace('%', '');
          const pct = parseFloat(raw);
          cell.s = isNaN(pct) ? rowStyle(isEven, 'center') : pctStyle(pct, isEven);
        } else {
          const align: 'left' | 'center' = firstColLeft && C2 === 0 ? 'left' : 'center';
          cell.s = rowStyle(isEven, align);
        }
      }
    }
  }
}

function applySumRowsToSheet(ws: XLSX.WorkSheet, rows: object[], markerCol: string, markerValue: string) {
  const range = XLSX.utils.decode_range(ws['!ref']!);
  rows.forEach((row: any, rowIdx) => {
    if (String(row[markerCol]) === markerValue) {
      const sheetRow = rowIdx + 1; // +1 for header row
      for (let c = range.s.c; c <= range.e.c; ++c) {
        const cellRef = XLSX.utils.encode_cell({ r: sheetRow, c });
        if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };
        ws[cellRef].s = sumRowStyle(c <= 1 ? 'left' : 'center');
      }
    }
  });
}

// ── Weekly Tests Excel ────────────────────────────────────────────────────────

export function exportWeeklyExcel(tests: WeeklyRow[], studentName: string) {
  const rows = tests.map((t) => {
    const pct = t.maxMarks > 0 ? parseFloat(((t.marks / t.maxMarks) * 100).toFixed(1)) : 0;
    return {
      'Date':       new Date(t.weekDate).toLocaleDateString(),
      'Type':       t.testType,
      'Subject':    t.subject,
      'Chapter':    t.chapter || '—',
      'Marks':      t.marks,
      'Max Marks':  t.maxMarks,
      '%':          pct,
      'Date Added': new Date(t.createdAt).toLocaleDateString(),
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  applyAutoWidth(ws, rows);
  setRowHeight(ws, rows.length);
  applyStyles(ws, rows, { firstColLeft: true, colorRules: [{ type: 'pct', colIndex: 6 }] });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Weekly Tests');
  downloadWorkbook(wb, `${studentName}_weekly_tests.xlsx`);
}

// ── Monthly Tests Excel ───────────────────────────────────────────────────────

export function exportMonthlyExcel(tests: MonthlyRow[], studentName: string) {
  const rows = tests.map((t) => {
    const pct = t.maxMarks > 0 ? parseFloat(((t.marks / t.maxMarks) * 100).toFixed(1)) : 0;
    return {
      'Period':     `${MONTHS[t.month]} ${t.year}`,
      'Type':       t.testType,
      'Subject':    t.subject,
      'Marks':      t.marks,
      'Max Marks':  t.maxMarks,
      '%':          pct,
      'Date Added': new Date(t.createdAt).toLocaleDateString(),
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  applyAutoWidth(ws, rows);
  setRowHeight(ws, rows.length);
  applyStyles(ws, rows, { firstColLeft: true, colorRules: [{ type: 'pct', colIndex: 5 }] });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Monthly Tests');
  downloadWorkbook(wb, `${studentName}_monthly_tests.xlsx`);
}

// ── CE Records Excel ──────────────────────────────────────────────────────────

export function exportCEExcel(records: CERow[], studentName: string) {
  // Sheet 1 – Summary: TOTAL row first (when 2+ months), then per-month rows
  const sortedRecs = [...records].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  const hasTotalRow = sortedRecs.length >= 2;
  const summary: object[] = [];

  if (hasTotalRow) {
    const totalCE = sortedRecs.reduce((a, r) => a + r.totalCE, 0);
    summary.push({
      'Period':          `TOTAL (${sortedRecs.length} months)`,
      'Theory (/10)':    parseFloat(sortedRecs.reduce((a, r) => a + r.theoryScore, 0).toFixed(2)),
      'MCQ (/5)':        parseFloat(sortedRecs.reduce((a, r) => a + r.mcqScore,    0).toFixed(2)),
      'Attendance (/3)': parseFloat(sortedRecs.reduce((a, r) => a + r.attendScore, 0).toFixed(2)),
      'Notes (/2)':      parseFloat(sortedRecs.reduce((a, r) => a + r.notesScore,  0).toFixed(2)),
      'Total CE (/20)':  parseFloat(totalCE.toFixed(2)),
      'Cumulative CE':   `${totalCE.toFixed(2)} / ${sortedRecs.length * 20}`,
      'Date Added':      '',
    });
  }
  let ceRunning = 0;
  for (let i = 0; i < sortedRecs.length; i++) {
    const r = sortedRecs[i];
    ceRunning += r.totalCE;
    summary.push({
      'Period':          `${MONTHS[r.month]} ${r.year}`,
      'Theory (/10)':    parseFloat(r.theoryScore.toFixed(2)),
      'MCQ (/5)':        parseFloat(r.mcqScore.toFixed(2)),
      'Attendance (/3)': parseFloat(r.attendScore.toFixed(2)),
      'Notes (/2)':      parseFloat(r.notesScore.toFixed(2)),
      'Total CE (/20)':  parseFloat(r.totalCE.toFixed(2)),
      'Cumulative CE':   `${ceRunning.toFixed(2)} / ${(i + 1) * 20}`,
      'Date Added':      new Date(r.createdAt).toLocaleDateString(),
    });
  }

  const wsSummary = XLSX.utils.json_to_sheet(summary);
  applyAutoWidth(wsSummary, summary);
  setRowHeight(wsSummary, summary.length);
  applyStyles(wsSummary, summary, {
    firstColLeft: true,
    colorRules: [{ type: 'ce', colIndex: 5 }],
    hasSumRowFirst: hasTotalRow,
  });

  // Sheet 2 – Subject marks
  const detail = records.map((r) => ({
    'Period':       `${MONTHS[r.month]} ${r.year}`,
    'Physics':      `${r.physicsMarks}/${r.physicsMax}`,
    'Chemistry':    `${r.chemMarks}/${r.chemMax}`,
    'Math':         r.mathMax > 0 ? `${r.mathMarks}/${r.mathMax}` : '—',
    'Biology':      `${r.bioMarks}/${r.bioMax}`,
    'Language 1':   `${r.lang1Marks}/${r.lang1Max}`,
    'Language 2':   `${r.lang2Marks}/${r.lang2Max}`,
    'Psychology':      r.psychologyMax > 0 ? `${r.psychologyMarks}/${r.psychologyMax}` : '—',
    'Computer Sci':   r.computerScienceMax > 0 ? `${r.computerScienceMarks}/${r.computerScienceMax}` : '—',
    'MCQ %':           parseFloat(r.mcqPct.toFixed(1)),
    'Attendance %': r.attendancePct,
    'Med. Cert':    r.hasMedCert ? 'Yes' : 'No',
    'Notes Status': r.notesStatus,
    'Date Added':   new Date(r.createdAt).toLocaleDateString(),
  }));
  const wsDetail = XLSX.utils.json_to_sheet(detail);
  applyAutoWidth(wsDetail, detail);
  setRowHeight(wsDetail, detail.length);
  applyStyles(wsDetail, detail, {
    firstColLeft: true,
    colorRules: [
      { type: 'pct', colIndex: 8 },
      { type: 'pct', colIndex: 9 },
    ],
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, 'CE Summary');
  XLSX.utils.book_append_sheet(wb, wsDetail,  'Subject Marks');
  downloadWorkbook(wb, `${studentName}_CE_records.xlsx`);
}

// ── Student List Excel ────────────────────────────────────────────────────────

export function exportStudentsExcel(students: StudentRow[], batchName: string) {
  const rows = students.map((s, i) => ({
    '#':         i + 1,
    'Reg No.':   s.regNumber,
    'Full Name': s.fullName,
    'Batch':     s.batchName,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  applyAutoWidth(ws, rows);
  setRowHeight(ws, rows.length);
  applyStyles(ws, rows, { firstColLeft: false });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  downloadWorkbook(wb, `${batchName}_students.xlsx`);
}

// ── Batch All-Marks Excel ─────────────────────────────────────────────────────

export function exportBatchExcel(students: BatchReportStudent[], batchName: string) {
  const wb = XLSX.utils.book_new();

  // Sheet 1 – CE Records: one row per student, all months summed
  const ceRows = students
    .filter((s) => s.ceRecords.length > 0)
    .map((s) => {
      const n = s.ceRecords.length;
      return {
        'Reg No.':          s.regNumber,
        'Name':             s.fullName,
        'Months':           n,
        'Theory (/10×n)':   parseFloat(s.ceRecords.reduce((a, r) => a + r.theoryScore, 0).toFixed(2)),
        'MCQ (/5×n)':       parseFloat(s.ceRecords.reduce((a, r) => a + r.mcqScore,    0).toFixed(2)),
        'Attendance (/3×n)':parseFloat(s.ceRecords.reduce((a, r) => a + r.attendScore, 0).toFixed(2)),
        'Notes (/2×n)':     parseFloat(s.ceRecords.reduce((a, r) => a + r.notesScore,  0).toFixed(2)),
        'Total CE':         parseFloat(s.ceRecords.reduce((a, r) => a + r.totalCE,     0).toFixed(2)),
        'Max CE':           n * 20,
      };
    });
  const wsCE = XLSX.utils.json_to_sheet(ceRows.length ? ceRows : [{ Note: 'No CE records' }]);
  if (ceRows.length) {
    applyAutoWidth(wsCE, ceRows);
    setRowHeight(wsCE, ceRows.length);
    applyStyles(wsCE, ceRows, { firstColLeft: true, colorRules: [{ type: 'ce', colIndex: 7 }] });
  }
  XLSX.utils.book_append_sheet(wb, wsCE, 'CE Records');

  // Sheet 2 – CE Per Month: TOTAL row first per student (when 2+ months), then per-month rows
  const cePerMonthRows: object[] = [];
  for (const s of students) {
    const sorted = [...s.ceRecords].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    if (sorted.length >= 2) {
      const totalCE = sorted.reduce((a, r) => a + r.totalCE, 0);
      cePerMonthRows.push({
        'Reg No.':         s.regNumber,
        'Name':            s.fullName,
        'Period':          'TOTAL',
        'Theory (/10)':    parseFloat(sorted.reduce((a, r) => a + r.theoryScore, 0).toFixed(2)),
        'MCQ (/5)':        parseFloat(sorted.reduce((a, r) => a + r.mcqScore,    0).toFixed(2)),
        'Attendance (/3)': parseFloat(sorted.reduce((a, r) => a + r.attendScore, 0).toFixed(2)),
        'Notes (/2)':      parseFloat(sorted.reduce((a, r) => a + r.notesScore,  0).toFixed(2)),
        'CE (/20)':        parseFloat(totalCE.toFixed(2)),
        'Cumulative CE':   `${totalCE.toFixed(2)} / ${sorted.length * 20}`,
      });
    }
    let running = 0;
    for (let i = 0; i < sorted.length; i++) {
      running += sorted[i].totalCE;
      cePerMonthRows.push({
        'Reg No.':         s.regNumber,
        'Name':            s.fullName,
        'Period':          `${MONTHS[sorted[i].month]} ${sorted[i].year}`,
        'Theory (/10)':    parseFloat(sorted[i].theoryScore.toFixed(2)),
        'MCQ (/5)':        parseFloat(sorted[i].mcqScore.toFixed(2)),
        'Attendance (/3)': parseFloat(sorted[i].attendScore.toFixed(2)),
        'Notes (/2)':      parseFloat(sorted[i].notesScore.toFixed(2)),
        'CE (/20)':        parseFloat(sorted[i].totalCE.toFixed(2)),
        'Cumulative CE':   `${running.toFixed(2)} / ${(i + 1) * 20}`,
      });
    }
  }
  const wsCEMonth = XLSX.utils.json_to_sheet(cePerMonthRows.length ? cePerMonthRows : [{ Note: 'No CE records' }]);
  if (cePerMonthRows.length) {
    applyAutoWidth(wsCEMonth, cePerMonthRows);
    setRowHeight(wsCEMonth, cePerMonthRows.length);
    applyStyles(wsCEMonth, cePerMonthRows, { firstColLeft: true, colorRules: [{ type: 'ce', colIndex: 7 }] });
    applySumRowsToSheet(wsCEMonth, cePerMonthRows, 'Period', 'TOTAL');
  }
  XLSX.utils.book_append_sheet(wb, wsCEMonth, 'CE Per Month');

  // Sheet 3 – Weekly Tests
  const weeklyRows = students.flatMap((s) =>
    s.weeklyTests.map((t) => {
      const pct = t.maxMarks > 0 ? parseFloat(((t.marks / t.maxMarks) * 100).toFixed(1)) : 0;
      return {
        'Reg No.':   s.regNumber,
        'Name':      s.fullName,
        'Date':      new Date(t.weekDate).toLocaleDateString(),
        'Type':      t.testType,
        'Subject':   t.subject,
        'Chapter':   t.chapter || '—',
        'Marks':     t.marks,
        'Max':       t.maxMarks,
        '%':         pct,
        'Date Added':new Date(t.createdAt).toLocaleDateString(),
      };
    })
  );
  const wsWeekly = XLSX.utils.json_to_sheet(weeklyRows.length ? weeklyRows : [{ Note: 'No weekly tests' }]);
  if (weeklyRows.length) {
    applyAutoWidth(wsWeekly, weeklyRows);
    setRowHeight(wsWeekly, weeklyRows.length);
    applyStyles(wsWeekly, weeklyRows, { firstColLeft: true, colorRules: [{ type: 'pct', colIndex: 8 }] });
  }
  XLSX.utils.book_append_sheet(wb, wsWeekly, 'Weekly Tests');

  // Sheet 4 – Monthly Tests
  const monthlyRows = students.flatMap((s) =>
    s.monthlyTests.map((t) => {
      const pct = t.maxMarks > 0 ? parseFloat(((t.marks / t.maxMarks) * 100).toFixed(1)) : 0;
      return {
        'Reg No.':   s.regNumber,
        'Name':      s.fullName,
        'Period':    `${MONTHS[t.month]} ${t.year}`,
        'Type':      t.testType,
        'Subject':   t.subject,
        'Marks':     t.marks,
        'Max':       t.maxMarks,
        '%':         pct,
        'Date Added':new Date(t.createdAt).toLocaleDateString(),
      };
    })
  );
  const wsMonthly = XLSX.utils.json_to_sheet(monthlyRows.length ? monthlyRows : [{ Note: 'No monthly tests' }]);
  if (monthlyRows.length) {
    applyAutoWidth(wsMonthly, monthlyRows);
    setRowHeight(wsMonthly, monthlyRows.length);
    applyStyles(wsMonthly, monthlyRows, { firstColLeft: true, colorRules: [{ type: 'pct', colIndex: 7 }] });
  }
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'Monthly Tests');

  downloadWorkbook(wb, `${batchName}_all_marks.xlsx`);
}

// ── PDF Styling and Base Layout ──────────────────────────────────────────────

function basePDF(title: string, studentName: string) {
  const doc = new jsPDF();

  doc.setFillColor(79, 70, 229); // Indigo-600 top bar
  doc.rect(0, 0, 210, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, 18);

  // Embed DOPA logo on the top right
  try {
    doc.addImage('/dopa-logo.png', 'PNG', 165, 8, 31, 15);
  } catch (e) {
    console.error('Failed to add logo:', e);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Student Name: ', 14, 25);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(79, 70, 229);
  doc.text(studentName, 42, 25);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Report Date:  ${new Date().toLocaleDateString()}`, 14, 31);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(14, 35, 196, 35);

  return doc;
}

// ── Weekly Tests PDF ─────────────────────────────────────────────────────────

export function exportWeeklyPDF(tests: WeeklyRow[], studentName: string) {
  const doc = basePDF('Weekly Test Report', studentName);
  autoTable(doc, {
    startY: 40,
    head:   [['Date', 'Type', 'Subject', 'Chapter', 'Marks', 'Max', '%', 'Date Added']],
    body:   tests.map((t) => [
      new Date(t.weekDate).toLocaleDateString(),
      t.testType,
      t.subject,
      t.chapter || '—',
      t.marks,
      t.maxMarks,
      t.maxMarks > 0 ? `${((t.marks / t.maxMarks) * 100).toFixed(1)}%` : '—',
      new Date(t.createdAt).toLocaleDateString(),
    ]),
    headStyles:  { fillColor: [15, 23, 42], fontSize: 9, fontStyle: 'bold', halign: 'center' },
    bodyStyles:  { fontSize: 8.5, textColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { halign: 'left' }, 2: { halign: 'left' }, 3: { halign: 'left' } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        const val = parseFloat(String(data.cell.text[0]));
        if (!isNaN(val)) {
          if (val >= 80)      data.cell.styles.textColor = [4, 120, 87];
          else if (val >= 50) data.cell.styles.textColor = [180, 83, 9];
          else                data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });
  doc.save(`${studentName}_weekly_tests.pdf`);
}

// ── Monthly Tests PDF ────────────────────────────────────────────────────────

export function exportMonthlyPDF(tests: MonthlyRow[], studentName: string) {
  const doc = basePDF('Monthly Test Report', studentName);
  autoTable(doc, {
    startY: 40,
    head:   [['Period', 'Type', 'Subject', 'Marks', 'Max', '%', 'Date Added']],
    body:   tests.map((t) => [
      `${MONTHS[t.month]} ${t.year}`,
      t.testType,
      t.subject,
      t.marks,
      t.maxMarks,
      t.maxMarks > 0 ? `${((t.marks / t.maxMarks) * 100).toFixed(1)}%` : '—',
      new Date(t.createdAt).toLocaleDateString(),
    ]),
    headStyles:  { fillColor: [15, 23, 42], fontSize: 9, fontStyle: 'bold', halign: 'center' },
    bodyStyles:  { fontSize: 8.5, textColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { halign: 'left' }, 2: { halign: 'left' } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const val = parseFloat(String(data.cell.text[0]));
        if (!isNaN(val)) {
          if (val >= 80)      data.cell.styles.textColor = [4, 120, 87];
          else if (val >= 50) data.cell.styles.textColor = [180, 83, 9];
          else                data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });
  doc.save(`${studentName}_monthly_tests.pdf`);
}

// ── Student List PDF ──────────────────────────────────────────────────────────

export function exportStudentsPDF(students: StudentRow[], batchName: string) {
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, 297, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Student List', 14, 18);

  // Embed DOPA logo on top right (landscape)
  try {
    doc.addImage('/dopa-logo.png', 'PNG', 252, 8, 31, 15);
  } catch (e) {
    console.error('Failed to add logo:', e);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Batch: ', 14, 25);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(79, 70, 229);
  doc.text(batchName, 28, 25);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${new Date().toLocaleDateString()}  ·  Total Students: ${students.length}`, 14, 31);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(14, 35, 283, 35);

  autoTable(doc, {
    startY: 40,
    head:   [['#', 'Reg No.', 'Full Name', 'Batch']],
    body:   students.map((s, i) => [i + 1, s.regNumber, s.fullName, s.batchName]),
    headStyles:  { fillColor: [15, 23, 42], fontSize: 9.5, fontStyle: 'bold' },
    bodyStyles:  { fontSize: 8.5, textColor: [30, 41, 59] },
    columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 2: { cellWidth: 80 } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
  });
  doc.save(`${batchName}_students.pdf`);
}

// ── CE Records PDF ────────────────────────────────────────────────────────────

export function exportCEPDF(records: CERow[], studentName: string) {
  const doc = basePDF('CE Records Report', studentName);

  const sortedForPDF = [...records].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  const ceBodyPDF: string[][] = [];
  const pdfTotalIdx = sortedForPDF.length >= 2 ? 0 : -1;

  if (sortedForPDF.length >= 2) {
    const totalCE = sortedForPDF.reduce((a, r) => a + r.totalCE, 0);
    ceBodyPDF.push([
      'TOTAL',
      sortedForPDF.reduce((a, r) => a + r.theoryScore, 0).toFixed(2),
      sortedForPDF.reduce((a, r) => a + r.mcqScore,    0).toFixed(2),
      sortedForPDF.reduce((a, r) => a + r.attendScore, 0).toFixed(2),
      sortedForPDF.reduce((a, r) => a + r.notesScore,  0).toFixed(2),
      totalCE.toFixed(2),
      `${totalCE.toFixed(2)} / ${sortedForPDF.length * 20}`,
      '',
    ]);
  }
  let pdfRunning = 0;
  for (let i = 0; i < sortedForPDF.length; i++) {
    const r = sortedForPDF[i];
    pdfRunning += r.totalCE;
    ceBodyPDF.push([
      `${MONTHS[r.month]} ${r.year}`,
      r.theoryScore.toFixed(2),
      r.mcqScore.toFixed(2),
      r.attendScore.toFixed(2),
      r.notesScore.toFixed(2),
      r.totalCE.toFixed(2),
      `${pdfRunning.toFixed(2)} / ${(i + 1) * 20}`,
      new Date(r.createdAt).toLocaleDateString(),
    ]);
  }

  autoTable(doc, {
    startY: 40,
    head:   [['Period', 'Theory\n(/10)', 'MCQ\n(/5)', 'Attend.\n(/3)', 'Notes\n(/2)', 'Total CE\n(/20)', 'Cumulative\nCE', 'Date Added']],
    body:   ceBodyPDF,
    headStyles:  { fillColor: [15, 23, 42], fontSize: 9, fontStyle: 'bold', halign: 'center' },
    bodyStyles:  { fontSize: 8, textColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { halign: 'left' }, 6: { fontStyle: 'bold' } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === pdfTotalIdx) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [15, 23, 42];
        data.cell.styles.textColor = [255, 255, 255];
        return;
      }
      if (data.section === 'body' && data.column.index === 5) {
        const val = parseFloat(data.cell.text[0]);
        if (val >= 15)      { data.cell.styles.textColor = [4, 120, 87]; data.cell.styles.fontStyle = 'bold'; }
        else if (val >= 10) { data.cell.styles.textColor = [180, 83, 9]; data.cell.styles.fontStyle = 'bold'; }
        else                { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
      }
      if (data.section === 'body' && data.column.index === 6) {
        const parts = data.cell.text[0].split('/');
        if (parts.length === 2) {
          const pct = (parseFloat(parts[0]) / parseFloat(parts[1])) * 100;
          if (pct >= 75)      data.cell.styles.textColor = [4, 120, 87];
          else if (pct >= 50) data.cell.styles.textColor = [180, 83, 9];
          else                data.cell.styles.textColor = [185, 28, 28];
        }
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  const afterSummary = (doc as any).lastAutoTable?.finalY ?? 80;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Subject-wise Marks Details', 14, afterSummary + 12);

  autoTable(doc, {
    startY: afterSummary + 16,
    head:   [['Period', 'Physics', 'Chemistry', 'Math', 'Biology', 'Lang 1', 'Lang 2', 'Psychology', 'Computer Sci', 'MCQ%', 'Att.%']],
    body:   records.map((r) => [
      `${MONTHS[r.month]} ${r.year}`,
      r.physicsMax > 0 ? `${r.physicsMarks}/${r.physicsMax}` : '—',
      r.chemMax > 0 ? `${r.chemMarks}/${r.chemMax}` : '—',
      r.mathMax > 0 ? `${r.mathMarks}/${r.mathMax}` : '—',
      r.bioMax > 0 ? `${r.bioMarks}/${r.bioMax}` : '—',
      r.lang1Max > 0 ? `${r.lang1Marks}/${r.lang1Max}` : '—',
      r.lang2Max > 0 ? `${r.lang2Marks}/${r.lang2Max}` : '—',
      r.psychologyMax > 0 ? `${r.psychologyMarks}/${r.psychologyMax}` : '—',
      r.computerScienceMax > 0 ? `${r.computerScienceMarks}/${r.computerScienceMax}` : '—',
      `${r.mcqPct.toFixed(0)}%`,
      `${r.attendancePct}%`,
    ]),
    headStyles:  { fillColor: [79, 70, 229], fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    bodyStyles:  { fontSize: 8, textColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { halign: 'left' } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    didParseCell: (data) => {
      if (data.section === 'body' && (data.column.index === 8 || data.column.index === 9)) {
        const val = parseFloat(String(data.cell.text[0]));
        if (!isNaN(val)) {
          if (val >= 80)      data.cell.styles.textColor = [4, 120, 87];
          else if (val >= 50) data.cell.styles.textColor = [180, 83, 9];
          else                data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  doc.save(`${studentName}_CE_records.pdf`);
}

// ── Student Report Card PDF ───────────────────────────────────────────────────

export interface ReportCardData {
  student: { fullName: string; regNumber: string; batch?: { name: string } };
  ceRecords: CERow[];
  remarks?: { category: string; text: string; createdAt: string }[];
}

export function exportReportCardPDF({ student, ceRecords, remarks = [] }: ReportCardData) {
  const doc = new jsPDF();
  const generated = new Date().toLocaleDateString();

  // Full-bleed Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 32, 210, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('DOPA ACADEMY', 14, 13);

  // Embed DOPA logo on the top right of the dark banner
  try {
    doc.addImage('/dopa-logo.png', 'PNG', 165, 8, 31, 15);
  } catch (e) {
    console.error('Failed to add logo:', e);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text('Continuous Evaluation & Performance Report Card', 14, 20);
  doc.text(`Generated: ${generated}`, 14, 26);

  // Student Profile
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(student.fullName, 14, 44);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Registration No: ${student.regNumber}   |   Batch: ${student.batch?.name ?? '—'}`, 14, 50);

  if (ceRecords.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    doc.text('No CE records available.', 14, 62);
    doc.save(`${student.fullName}_report_card.pdf`);
    return;
  }

  // Cumulative Summary Block
  const total    = ceRecords.reduce((a, r) => a + r.totalCE, 0);
  const maxTotal = ceRecords.length * 20;
  const avgAtt   = ceRecords.reduce((a, r) => a + r.attendancePct, 0) / ceRecords.length;
  const avgCE    = total / ceRecords.length;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.roundedRect(14, 56, 182, 22, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(79, 70, 229);
  doc.text('CUMULATIVE CE SCORE', 20, 64);
  doc.setFontSize(12.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`${total.toFixed(1)} / ${maxTotal}`, 20, 71);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text('AVG CE / PERIOD', 85, 64);
  doc.setFontSize(12.5);
  // Color-code avg CE
  if (avgCE >= 15)      doc.setTextColor(4, 120, 87);
  else if (avgCE >= 10) doc.setTextColor(180, 83, 9);
  else                  doc.setTextColor(185, 28, 28);
  doc.text(`${avgCE.toFixed(1)} / 20`, 85, 71);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text('AVG ATTENDANCE', 145, 64);
  doc.setFontSize(12.5);
  if (avgAtt >= 90)     doc.setTextColor(4, 120, 87);
  else if (avgAtt >= 75) doc.setTextColor(180, 83, 9);
  else                  doc.setTextColor(185, 28, 28);
  doc.text(`${avgAtt.toFixed(0)}%`, 145, 71);

  // CE records table — sorted chronologically for cumulative calculation
  const sortedCE = [...ceRecords].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  let runningTotal = 0;
  const ceBodyRows = sortedCE.map((r, i) => {
    runningTotal += r.totalCE;
    const maxSoFar = (i + 1) * 20;
    return [
      `${MONTHS[r.month]} ${r.year}`,
      r.theoryScore.toFixed(1),
      r.mcqScore.toFixed(1),
      r.attendScore.toFixed(1),
      r.notesScore.toFixed(1),
      r.totalCE.toFixed(1),
      `${runningTotal.toFixed(1)} / ${maxSoFar}`,
      `${r.attendancePct}%`,
    ];
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Monthly CE Records Summary', 14, 88);

  autoTable(doc, {
    startY: 92,
    head: [['Period', 'Theory\n(/10)', 'MCQ\n(/5)', 'Attend.\n(/3)', 'Notes\n(/2)', 'Total\n(/20)', 'Cumulative\nCE', 'Attendance']],
    body: ceBodyRows,
    headStyles:  { fillColor: [15, 23, 42], fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    bodyStyles:  { fontSize: 8, textColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { halign: 'left' }, 6: { fontStyle: 'bold' } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const val = parseFloat(data.cell.text[0]);
        if (val >= 15)      { data.cell.styles.textColor = [4, 120, 87];   data.cell.styles.fontStyle = 'bold'; }
        else if (val >= 10) { data.cell.styles.textColor = [180, 83, 9];   data.cell.styles.fontStyle = 'bold'; }
        else                { data.cell.styles.textColor = [185, 28, 28];  data.cell.styles.fontStyle = 'bold'; }
      }
      if (data.section === 'body' && data.column.index === 6) {
        // Colour cumulative cell by percentage of max possible
        const parts = data.cell.text[0].split('/');
        if (parts.length === 2) {
          const cum = parseFloat(parts[0]);
          const max = parseFloat(parts[1]);
          const pct = max > 0 ? (cum / max) * 100 : 0;
          if (pct >= 75)      data.cell.styles.textColor = [4, 120, 87];
          else if (pct >= 50) data.cell.styles.textColor = [180, 83, 9];
          else                data.cell.styles.textColor = [185, 28, 28];
        }
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.column.index === 7) {
        const val = parseFloat(String(data.cell.text[0]));
        if (val >= 90)      data.cell.styles.textColor = [4, 120, 87];
        else if (val >= 75) data.cell.styles.textColor = [180, 83, 9];
        else                data.cell.styles.textColor = [185, 28, 28];
      }
    },
  });

  // Subject averages
  const afterCE = (doc as any).lastAutoTable?.finalY ?? 120;
  if (afterCE < 240) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Subject-wise Performance Breakdown', 14, afterCE + 10);

    const subjects = [
      { label: 'Physics',    mk: 'physicsMarks', mx: 'physicsMax' },
      { label: 'Chemistry',  mk: 'chemMarks',    mx: 'chemMax' },
      { label: 'Math',       mk: 'mathMarks',    mx: 'mathMax' },
      { label: 'Biology',    mk: 'bioMarks',     mx: 'bioMax' },
      { label: 'Language 1', mk: 'lang1Marks',   mx: 'lang1Max' },
      { label: 'Language 2', mk: 'lang2Marks',   mx: 'lang2Max' },
      { label: 'Psychology',      mk: 'psychologyMarks',     mx: 'psychologyMax' },
      { label: 'Computer Science', mk: 'computerScienceMarks', mx: 'computerScienceMax' },
    ];
    const subRows = subjects.map((s) => {
      const validRecs = ceRecords.filter((r) => (r as any)[s.mx] > 0);
      if (validRecs.length === 0) return [s.label, '—', '—'];
      const avg = validRecs.reduce((a, r) => a + ((r as any)[s.mk] / (r as any)[s.mx]) * 100, 0) / validRecs.length;
      return [
        s.label,
        `${avg.toFixed(1)}%`,
        validRecs.length > 1 ? `Across ${validRecs.length} periods` : 'Across 1 period',
      ];
    });

    autoTable(doc, {
      startY: afterCE + 14,
      head: [['Subject', 'Average Score %', 'Period Coverage']],
      body: subRows,
      headStyles:  { fillColor: [79, 70, 229], fontSize: 9, fontStyle: 'bold' },
      bodyStyles:  { fontSize: 8.5, textColor: [30, 41, 59] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      tableLineColor: [226, 232, 240],
      tableLineWidth: 0.2,
      columnStyles: {
        1: { halign: 'center', fontStyle: 'bold' },
        2: { textColor: [100, 116, 139] },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 1 && data.cell.text[0] !== '—') {
          const val = parseFloat(data.cell.text[0]);
          if (val >= 75)      data.cell.styles.textColor = [4, 120, 87];
          else if (val >= 50) data.cell.styles.textColor = [180, 83, 9];
          else                data.cell.styles.textColor = [185, 28, 28];
        }
      },
    });
  }

  // Remarks (latest 5)
  if (remarks.length > 0) {
    const afterSub = (doc as any).lastAutoTable?.finalY ?? afterCE + 60;
    if (afterSub < 240) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text('Latest Teacher Feedback & Mentorship Notes', 14, afterSub + 10);
      autoTable(doc, {
        startY: afterSub + 14,
        head: [['Category', 'Feedback', 'Date']],
        body: remarks.slice(0, 5).map((r) => [
          r.category,
          r.text.length > 90 ? r.text.slice(0, 90) + '…' : r.text,
          new Date(r.createdAt).toLocaleDateString(),
        ]),
        headStyles:  { fillColor: [15, 23, 42], fontSize: 9, fontStyle: 'bold' },
        bodyStyles:  { fontSize: 8.5, textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        tableLineColor: [226, 232, 240],
        tableLineWidth: 0.2,
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 }, 1: { cellWidth: 120 } },
      });
    }
  }

  // Footer on every page
  const pageCount = (doc as any).internal.pages.length - 1;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('DOPA Coaching — Academic Performance Division', 14, 290);
    doc.text(`Page ${i} of ${pageCount}`, 180, 290);
  }

  doc.save(`${student.fullName}_report_card.pdf`);
}

// ── Batch All-Marks PDF ───────────────────────────────────────────────────────

export function exportBatchPDF(students: BatchReportStudent[], batchName: string) {
  const doc = new jsPDF();
  const generated = new Date().toLocaleDateString();

  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, 210, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(`Batch Marks Report — ${batchName}`, 14, 18);

  // Embed DOPA logo on the top right
  try {
    doc.addImage('/dopa-logo.png', 'PNG', 165, 8, 31, 15);
  } catch (e) {
    console.error('Failed to add logo:', e);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${generated}  ·  Total Students: ${students.length}`, 14, 25);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(14, 29, 196, 29);

  // CE Records table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('CE Records Summary', 14, 37);

  // CE table: one row per student, all months summed, Theory and MCQ separate
  const ceBody = students
    .filter((s) => s.ceRecords.length > 0)
    .map((s) => {
      const n = s.ceRecords.length;
      const theory     = s.ceRecords.reduce((a, r) => a + r.theoryScore, 0).toFixed(2);
      const mcq        = s.ceRecords.reduce((a, r) => a + r.mcqScore,    0).toFixed(2);
      const attendance = s.ceRecords.reduce((a, r) => a + r.attendScore, 0).toFixed(2);
      const notes      = s.ceRecords.reduce((a, r) => a + r.notesScore,  0).toFixed(2);
      const totalCE    = s.ceRecords.reduce((a, r) => a + r.totalCE,     0).toFixed(2);
      return [s.regNumber, s.fullName, n, theory, mcq, attendance, notes, totalCE, n * 20];
    });

  autoTable(doc, {
    startY: 41,
    head:   [['Reg No.', 'Name', 'Months', 'Theory\n(/10×n)', 'MCQ\n(/5×n)', 'Attend.\n(/3×n)', 'Notes\n(/2×n)', 'Total CE', 'Max CE']],
    body:   ceBody.length ? ceBody : [['—', 'No CE records', '', '', '', '', '', '', '']],
    headStyles:  { fillColor: [15, 23, 42], fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    bodyStyles:  { fontSize: 8, textColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { halign: 'left', cellWidth: 22 }, 1: { halign: 'left', cellWidth: 40 } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 7) {
        const total = parseFloat(data.cell.text[0]);
        const monthsCell = (data.row.raw as any[])[2];
        const avg = total / (parseFloat(String(monthsCell)) || 1);
        if (!isNaN(avg)) {
          if (avg >= 15)      { data.cell.styles.textColor = [4, 120, 87];  data.cell.styles.fontStyle = 'bold'; }
          else if (avg >= 10) { data.cell.styles.textColor = [180, 83, 9];  data.cell.styles.fontStyle = 'bold'; }
          else                { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
        }
      }
    },
  });

  // Monthly CE Breakdown table — per (student × month) with running cumulative
  const afterCESum = (doc as any).lastAutoTable?.finalY ?? 60;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Monthly CE Breakdown', 14, afterCESum + 10);

  const batchTotalRowIndices = new Set<number>();
  const ceBreakdownBody: (string | number)[][] = [];
  let breakdownIdx = 0;
  for (const s of students) {
    const sorted = [...s.ceRecords].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    if (sorted.length >= 2) {
      const totalCE = sorted.reduce((a, r) => a + r.totalCE, 0);
      batchTotalRowIndices.add(breakdownIdx);
      ceBreakdownBody.push([
        s.regNumber, s.fullName, 'TOTAL',
        sorted.reduce((a, r) => a + r.theoryScore, 0).toFixed(1),
        sorted.reduce((a, r) => a + r.mcqScore,    0).toFixed(1),
        sorted.reduce((a, r) => a + r.attendScore, 0).toFixed(1),
        sorted.reduce((a, r) => a + r.notesScore,  0).toFixed(1),
        totalCE.toFixed(1),
        `${totalCE.toFixed(1)} / ${sorted.length * 20}`,
      ]);
      breakdownIdx++;
    }
    let running = 0;
    for (let i = 0; i < sorted.length; i++) {
      running += sorted[i].totalCE;
      ceBreakdownBody.push([
        s.regNumber, s.fullName,
        `${MONTHS[sorted[i].month]} ${sorted[i].year}`,
        sorted[i].theoryScore.toFixed(1),
        sorted[i].mcqScore.toFixed(1),
        sorted[i].attendScore.toFixed(1),
        sorted[i].notesScore.toFixed(1),
        sorted[i].totalCE.toFixed(1),
        `${running.toFixed(1)} / ${(i + 1) * 20}`,
      ]);
      breakdownIdx++;
    }
  }

  autoTable(doc, {
    startY: afterCESum + 14,
    head:   [['Reg No.', 'Name', 'Period', 'Theory\n(/10)', 'MCQ\n(/5)', 'Attend.\n(/3)', 'Notes\n(/2)', 'CE\n(/20)', 'Cumulative\nCE']],
    body:   ceBreakdownBody.length ? ceBreakdownBody : [['—', 'No CE records', '', '', '', '', '', '', '']],
    headStyles:  { fillColor: [79, 70, 229], fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    bodyStyles:  { fontSize: 8, textColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { halign: 'left', cellWidth: 22 }, 1: { halign: 'left', cellWidth: 34 } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    didParseCell: (data) => {
      if (data.section === 'body' && batchTotalRowIndices.has(data.row.index)) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [15, 23, 42];
        data.cell.styles.textColor = [255, 255, 255];
        return;
      }
      if (data.section === 'body' && data.column.index === 7) {
        const val = parseFloat(data.cell.text[0]);
        if (!isNaN(val)) {
          if (val >= 15)      { data.cell.styles.textColor = [4, 120, 87];  data.cell.styles.fontStyle = 'bold'; }
          else if (val >= 10) { data.cell.styles.textColor = [180, 83, 9];  data.cell.styles.fontStyle = 'bold'; }
          else                { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
        }
      }
      if (data.section === 'body' && data.column.index === 8) {
        const parts = data.cell.text[0].split('/');
        if (parts.length === 2) {
          const pct = (parseFloat(parts[0]) / parseFloat(parts[1])) * 100;
          if (pct >= 75)      data.cell.styles.textColor = [4, 120, 87];
          else if (pct >= 50) data.cell.styles.textColor = [180, 83, 9];
          else                data.cell.styles.textColor = [185, 28, 28];
        }
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Weekly Tests table
  const afterCE = (doc as any).lastAutoTable?.finalY ?? 60;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Weekly Tests Performance', 14, afterCE + 10);

  const weeklyBody = students.flatMap((s) =>
    s.weeklyTests.map((t) => [
      s.regNumber, s.fullName,
      new Date(t.weekDate).toLocaleDateString(),
      t.testType, t.subject, t.chapter || '—', t.marks, t.maxMarks,
      t.maxMarks > 0 ? `${((t.marks / t.maxMarks) * 100).toFixed(1)}%` : '—',
      new Date(t.createdAt).toLocaleDateString(),
    ])
  );

  autoTable(doc, {
    startY: afterCE + 14,
    head:   [['Reg No.', 'Name', 'Date', 'Type', 'Subject', 'Chapter', 'Marks', 'Max', '%', 'Date Added']],
    body:   weeklyBody.length ? weeklyBody : [['—', 'No weekly tests', '', '', '', '', '', '', '', '']],
    headStyles:  { fillColor: [15, 23, 42], fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    bodyStyles:  { fontSize: 8, textColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { halign: 'left', cellWidth: 22 }, 1: { halign: 'left', cellWidth: 34 }, 4: { halign: 'left' } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 8) {
        const val = parseFloat(String(data.cell.text[0]));
        if (!isNaN(val)) {
          if (val >= 80)      { data.cell.styles.textColor = [4, 120, 87];  data.cell.styles.fontStyle = 'bold'; }
          else if (val >= 50) { data.cell.styles.textColor = [180, 83, 9];  data.cell.styles.fontStyle = 'bold'; }
          else                { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
        }
      }
    },
  });

  // Monthly Tests table
  const afterWeekly = (doc as any).lastAutoTable?.finalY ?? 60;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Monthly Tests Performance', 14, afterWeekly + 10);

  const monthlyBody = students.flatMap((s) =>
    s.monthlyTests.map((t) => [
      s.regNumber, s.fullName,
      `${MONTHS[t.month]} ${t.year}`,
      t.testType, t.subject, t.marks, t.maxMarks,
      t.maxMarks > 0 ? `${((t.marks / t.maxMarks) * 100).toFixed(1)}%` : '—',
      new Date(t.createdAt).toLocaleDateString(),
    ])
  );

  autoTable(doc, {
    startY: afterWeekly + 14,
    head:   [['Reg No.', 'Name', 'Period', 'Type', 'Subject', 'Marks', 'Max', '%', 'Date Added']],
    body:   monthlyBody.length ? monthlyBody : [['—', 'No monthly tests', '', '', '', '', '', '', '']],
    headStyles:  { fillColor: [15, 23, 42], fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    bodyStyles:  { fontSize: 8, textColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { halign: 'left', cellWidth: 22 }, 1: { halign: 'left', cellWidth: 34 }, 4: { halign: 'left' } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 7) {
        const val = parseFloat(String(data.cell.text[0]));
        if (!isNaN(val)) {
          if (val >= 80)      { data.cell.styles.textColor = [4, 120, 87];  data.cell.styles.fontStyle = 'bold'; }
          else if (val >= 50) { data.cell.styles.textColor = [180, 83, 9];  data.cell.styles.fontStyle = 'bold'; }
          else                { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
        }
      }
    },
  });

  // Footer
  const pageCount = (doc as any).internal.pages.length - 1;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('DOPA Coaching — Academic Performance Division', 14, 290);
    doc.text(`Page ${i} of ${pageCount}`, 180, 290);
  }

  doc.save(`${batchName}_all_marks.pdf`);
}
