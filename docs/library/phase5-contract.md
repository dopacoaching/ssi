# SSI Library — Phase 5 API contract
Lost/damaged, No-Dues + deactivation warning, dashboard, reports, stock check.

Builds on phase1–4 contracts (same folder). Response `{ success, message, data }`. Routes under `/api/library` use verifyToken + requireLibraryAccess, except the student-dues endpoint (§2b). Non-admins are confined to their own campus (`req.library.campusId`, `assertCampusAccess` / `campusFilter`). ADMIN-only endpoints are enforced server-side (403). Money: round2, never negative. Dates: Asia/Kolkata `YYYY-MM-DD`. Every write: audit after commit, awaited (Vercel), readable descriptions. Transactions: `withTransaction` callbacks must be retry-safe (no audit/side effects inside). Reuse existing helpers (`circulationService`, `fineService`, `chargeModel`, `finePeriodModel.touchEpoch/activeForCampus`, `studentState.decrement`, `loanModel.shapeMany`, `chargeModel.shapeMany`, response helpers). Do not duplicate logic that already exists.

Product decisions (from the owner, 2026-11-23):
- Deactivation warning appears wherever deactivation happens: teacher flow (existing) AND a new Admin deactivate. Both can proceed anyway.
- Lost book found later: copy back to AVAILABLE; charges are NOT touched (staff use a normal waiver request if needed).
- Minor damage: client pre-fills 25% of price and shows a soft warning above 25%. Server unchanged.
- Stock check: server-side, resumable, one OPEN check per campus.
- Overdue book inside a no-fine period still blocks issuing (unchanged).
- Own-campus staff may: report lost, mark found, mark repaired, run stock checks, mark missing copies lost.

---

## 1. Lost & damaged

### Schema additions
```ts
Loan  += { lostAt: Date|null; lostBy: ObjectId|null; foundAt: Date|null; foundBy: ObjectId|null }
        // backdated.lost?: { reason, by, at }  (same Mixed field as issue/return)
BookCopy += {
  lostAt: Date|null; lostBy: ObjectId|null; lostReason: string /*''*/;
  lostSource: null | 'LOAN' | 'STOCK_CHECK';  stockCheckId: ObjectId|null;
  repairedAt: Date|null; repairedBy: ObjectId|null;   // last repair
  foundAt: Date|null; foundBy: ObjectId|null;         // last found
}
```
`fineService.endAtFor` already uses `returnedAt || lostAt || asOf`. LoanView gains `lostAt`, `lostBy:{id,name}|null`, `foundAt`. For LOST loans, `daysLate/lateFine` are the frozen `fineDays/fineAmount` (same as RETURNED).

### POST /circulation/report-lost
Body: `loanId`*, `amount` (number ≥ 0, optional when the book has a price), `note` (≤ 500; **required** when `amount` differs from the book price), `lostAt` (ADMIN only, same window rules as return backdating: ≥ issuedAt, ≤ now, ≥ now−30d), `reason` (required with `lostAt`).
Access: staff of the LOAN's campus, or ADMIN.
ONE transaction (`circulationService.reportLost`, shaped like `returnLoan`):
1. `finePeriodModel.ensureCounter` before; inside: `touchEpoch(loan.campusId, 'lastReturnAt')` (same write-skew guard as return).
2. Breakdown with `fine.fineBreakdown({...loan, lostAt: endAt}, endAt, periods)`, endAt = lostAt || now.
3. `Loan.findOneAndUpdate({_id, status:'OPEN'}, {$set: {status:'LOST', lostAt, lostBy, fineDays, fineWaivedDays, waivedRanges, fineAmount, condition: null}})`; null → 400 "This loan is already closed".
4. `BookCopy.findOneAndUpdate({_id: loan.copyId, status:'ISSUED'}, {$set:{status:'LOST', lostAt, lostBy, lostReason: note||'Reported lost by student', lostSource:'LOAN', stockCheckId:null}})`; drift handled like return (`copyDriftStatus`).
5. `studentState.decrement(loan.studentId)`.
6. Charges: LATE if lateFine > 0 (note "Late until reported lost: N days × ₹r"), LOST with amount = `amount` ?? book.price; if neither → 400 "Enter the lost-book charge (this book has no price on record)". Amount 0 → no LOST charge.
Response: `{ loan: LoanView, charges: ChargeView[], student: { id, fullName, regNumber, outstanding }, copyDriftStatus }`.
Audit (Loan): `Reported lost IG1-00012 "Title" by 23R1045 (Name) — late fine ₹4, lost charge ₹350` (+ backdate reason).

**Fine periods:** `finePeriodService` create/preview currently consider RETURNED loans. They must ALSO include LOST loans (late window `(dueDate, istDate(lostAt)]`), with the same `waivedRanges` de-dup. Update the query in one place (status `$in: ['RETURNED','LOST']`, end = returnedAt ?? lostAt).

### POST /copies/:id/found
Body: `note` (≤ 500, optional). Access: copy's campus staff or ADMIN.
Conditional `BookCopy.findOneAndUpdate({_id, status:'LOST'}, {$set:{status:'AVAILABLE', foundAt: now, foundBy}})`; null → 400 "Copy is <status>, not Lost". If `lostSource==='LOAN'`, set `foundAt/foundBy` on the most recent LOST loan of that copy (`Loan.findOneAndUpdate({copyId, status:'LOST', foundAt:null}, …, {sort:{lostAt:-1}})`). Loan status stays LOST, charges untouched. Do it in one transaction.
Response: shaped copy (same shape as other /copies endpoints) + `loan: LoanView|null`.
Audit (BookCopy): `Marked found IG1-00012 "Title" (was lost by 23R1045 on 2026-12-01) — charges unchanged`.

### POST /copies/:id/repair
Body: `note` (≤ 500, optional). Access: copy's campus staff or ADMIN.
`BookCopy.findOneAndUpdate({_id, status:'DAMAGED'}, {$set:{status:'AVAILABLE', repairedAt, repairedBy}})`; null → 400 "Copy is <status>, not Damaged".
Audit (BookCopy): `Marked repaired IG1-00012 "Title"`.

### Catalog
`GET /books` already filters by copy status; make sure `status=LOST` and `status=DAMAGED` work across campuses for ADMIN. Copy shape gains the new fields (`lostAt`, `lostReason`, `lostSource`, `foundAt`, `repairedAt`).

---

## 2. No-Dues & deactivation warning

Shared service `server/services/clearanceService.js`:
`duesFor(studentId) → { openLoans: { loanId, campus:{id,name,code}, catalogNumber, title, dueDate, daysLate, lateFine, isOverdue }[], charges: { chargeId, campus:{…}, type, catalogNumber, title, balance }[] (balance > 0), outstanding: number /* Σ charge balances + Σ live lateFine of open loans */, isClear: boolean }`, across ALL campuses. Uses existing ledger helpers (`circulationService.loadLedger` / `summarizeLedger`) — do not re-implement fine maths.

### a) GET /library/clearance/:regNumber
Query: none. Access: any library staff. Student lookup by regNumber (`findStudentByReg`). Non-admins may look up ANY student (No-Dues is needed for students of any campus) but see other campuses' items only as a summary.
Returns `{ student: StudentCard['student'], isClear, outstanding, thisCampus: { openLoans:[…], charges:[…] } /* admin: all items */, otherCampuses: OtherCampusSummary|null /* null for admin */, checkedAt, checkedBy:{id,name}, campus /* the caller's campus (admin: null) */ }`. Also returns `isClear` for inactive students (No-Dues can be printed for inactive students).
### POST /library/clearance/:regNumber/slip
Re-checks; if not clear → 400 "Student has pending library dues". Else audits (entity `Student`, action `CREATE`? use a new action only if VALID_ACTIONS allows; otherwise `UPDATE`-style existing action that fits — check `utils/audit.js`) `Printed No-Dues slip for 23R1045 (Name)` and returns `{ reference: '<CAMPUSCODE|ALL>-ND-<YYYYMMDD>-<6 hex of audit/ObjectId>', issuedAt, issuedBy:{id,name}, student, campus }`. Client prints the slip with this data.

### b) GET /api/students/:id/library-dues  (outside /library)
Route in `server/routes/students.js`: `verifyToken, requireRole('ADMIN','TEACHER')`. TEACHER: student's batch must be in `req.user.batchIds` (403 otherwise). LIBRARIAN is already blocked from /api/students by `blockLibrarian`. Returns `duesFor(...)` with titles/catalog numbers for all campuses (dues are shown to the person deactivating). 404 if student missing.

### c) Deactivation
- `DELETE /api/students/:id` → `requireRole('ADMIN','TEACHER')`. Admin has no batch restriction. Behaviour otherwise unchanged (soft delete). Audit description appends ` — library dues pending: 1 book, ₹40` when `duesFor` is not clear (best effort; failure to compute dues must not block deactivation).
- Client: StudentDetail Deactivate button visible for ADMIN and TEACHER. The confirm modal fetches `/students/:id/library-dues`; if not clear, shows a yellow warning box listing the books (title, catalog no., campus, due/overdue) and charges, total outstanding, and "Dues stay on record and remain visible to the library." Confirm button stays enabled ("Deactivate anyway"). If the dues call fails, show "Could not check library dues" and still allow deactivation.

---

## 3. Dashboard

### GET /library/dashboard
Query: `campusId` (admin optional; omit = all campuses). Returns:
```ts
{
  campus: {id,name,code}|null,
  dueToday: { count, items: LoanView[] /* ≤ 10 */ },
  dueSoon:  { count, items: LoanView[] /* ≤ 10, due in next 1–2 days */ },
  overdue:  { count, items: LoanView[] /* ≤ 10, most late first */ },
  pendingFines: { balance /* Σ charge balances */, accruing /* live fines on open overdue loans */, studentCount },
  todayCollection: { myTotal, myCount, campusTotal, campusCount },   // voided excluded, IST today
  admin?: { pendingWaivers: number, lostCopies: number, damagedCopies: number, openStockChecks: number }  // ADMIN only
}
```
Reuse `loanModel.listOpen` (views dueToday/dueSoon/overdue, limit 10) and the Phase 4 pending/summary logic (extract shared functions if needed — don't copy).

Client `LibraryDashboard.tsx`: replace placeholders with widgets (counts + short lists linking to `/library/overdue`, `/library/fines`, `/library/payments`); quick boxes "Reg Number → Issue" and "Catalog No → Return" navigating to `/library/desk?reg=…` / `/library/desk?catalog=…` (Desk must read these query params and pre-load). Admin: campus picker (All / each campus) + admin tiles linking to waivers, catalog filtered LOST/DAMAGED, stock checks. Keep the Library rules card.

---

## 4. Reports

### GET /library/reports/:type
Query: `campusId` (admin optional = all combined; non-admin forced to own), `from`, `to` (YYYY-MM-DD IST, inclusive; defaults per report below), plus report-specific params. Returns:
```ts
{ type, title, campus: {id,name,code}|null, from: string|null, to: string|null, generatedAt,
  columns: { key: string; label: string; type: 'text'|'number'|'money'|'date' }[],
  rows: Record<string, string|number|null>[],      // max 5000 rows; if truncated set `truncated: true`
  totals: Record<string, number> | null }
```
Unknown type → 404. Types (`campus` column included when campusId omitted for admin):
| type | date filter | rows |
|---|---|---|
| `stock-summary` | none (as of now) | per category (blank → "Uncategorised"): titles, copies, available, issued, lost, damaged, withdrawn. Totals. |
| `issued` | none | open loans: catalogNumber, title, student, regNumber, batch, issuedAt, dueDate, daysLate. |
| `overdue` | none | overdue open loans: + daysLate, lateFine; sorted daysLate desc. Totals lateFine. |
| `fine-collection` | default this month; `group=day|month|staff` (default day) | day/month: period, receipts, amount; staff: staff, receipts, amount. Voided excluded. Totals. |
| `pending-fines` | none | per student: student, regNumber, batch, isActive, balance, accruing, chargeCount, oldestChargeAt. Totals. |
| `waivers` | default this month (by decidedAt for decided, requestedAt for pending) ; `status` optional | date, student, regNumber, chargeType, catalogNumber, type, status, amount, approvedAmount, reason, requestedBy, decidedBy. Totals approved. |
| `lost-damaged` | default this year (by lostAt / loan returnedAt / copy lostAt for stock check) | catalogNumber, title, event (LOST_BY_STUDENT / LOST_STOCK_CHECK / DAMAGED_MINOR / DAMAGED_MAJOR), date, student/regNumber (blank for stock check), charged, paid, waived, balance, found (date or blank). Totals charged/paid. |
| `most-borrowed` | default last 12 months (by issuedAt); `limit` ≤ 200 default 50 | title, author, category, copies, loans. Sorted loans desc. |
| `never-borrowed` | `months` default 12 (no loan with issuedAt in last N months) | book title, author, category, copies (non-withdrawn), catalogNumbers, lastIssuedAt (or blank). Only books with ≥1 non-withdrawn copy. |
| `student-borrowing` | default last 12 months; `group=student|batch` (default student) | student: student, regNumber, batch, loans, overdueReturns, finesCharged; batch: batch, students, loans. Sorted loans desc, limit 500. |
| `campus-comparison` | default this month for flows | ADMIN only (403). Per campus: titles, copies, available, issued now, overdue now, loans in range, collected in range, pending balance. Totals. |

Use aggregation pipelines with indexed matches; batch name lookups. Fines for overdue/pending use the same fine rule (periods) as Phase 4 — call existing helpers.

Client: `/library/reports` page (all library staff). Report picker, campus picker (admin, includes "All campuses"), date range when applicable, report-specific controls, table, "Excel" and "PDF" buttons. Generic exporter `exportReportExcel(report)` / `exportReportPDF(report)` in `client/src/utils/libraryExport.ts`, using `headerStyle/rowStyle` and jsPDF + autotable (landscape when > 7 columns), title + campus + date range + generatedAt in the header, totals row bold. Money formatted ₹, dates DD-MM-YYYY.

---

## 5. Stock check

### Collections
```ts
StockCheck {        // collection 'StockCheck'
  campusId; status: 'OPEN'|'CLOSED'|'CANCELLED';
  startedBy; startedAt; note: string;
  closedBy|null; closedAt|null; cancelledBy|null; cancelledAt|null; cancelReason: string;
  expectedCount: number|null;           // AVAILABLE copies at close
  missing: { copyId; catalogNumber; title; shelfLocation; markedLostAt: Date|null }[];   // snapshot at close
  scanCount: number;                    // $inc on scan / undo
}
StockCheckScan {    // collection 'StockCheckScan'
  stockCheckId; campusId; copyId; catalogNumber; statusAtScan: string; scannedBy; scannedAt;
}
```
Indexes (schema AND `scripts/library-indexes.js`): StockCheck `{campusId:1}` unique partial `{status:'OPEN'}` name `campusId_open_unique`; StockCheck `{campusId:1, startedAt:-1}`; StockCheckScan `{stockCheckId:1, copyId:1}` unique name `stockCheckId_copyId`; StockCheckScan `{stockCheckId:1, scannedAt:-1}`.

### Endpoints (/library/stock-checks)
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | /stock-checks | `campusId` (admin opt.), `page`, `limit` | `{ items: StockCheckView[], total, page, limit }` newest first |
| POST | /stock-checks | `campusId` (admin*), `note` | 201 StockCheckView. Duplicate key → 400 "A stock check is already open for this campus" |
| GET | /stock-checks/:id | – | `StockCheckView & { progress: { shelf, expected /*AVAILABLE copies on that shelf now*/, scanned }[], recentScans: ScanView[] /* 20 */ }` |
| POST | /stock-checks/:id/scan | `catalogNumber`* | `{ result: 'OK'|'ALREADY_SCANNED'|'WRONG_CAMPUS'|'NOT_FOUND'|'ISSUED'|'LOST'|'DAMAGED'|'WITHDRAWN', message, copy: {id, catalogNumber, status, shelfLocation, title}|null, scanCount }`. Check must be OPEN (400). OK / ISSUED / LOST / DAMAGED / WITHDRAWN are recorded as scans (insert; duplicate key → ALREADY_SCANNED, no $inc). NOT_FOUND / WRONG_CAMPUS are not recorded. Messages: ISSUED "Marked Issued to 23R1045 — check the loan", LOST "Marked Lost — use Mark found", etc. |
| DELETE | /stock-checks/:id/scans/:copyId | – | `{ scanCount }` (OPEN only) |
| POST | /stock-checks/:id/close | – | StockCheckView with `missing`. Conditional `{_id, status:'OPEN'}` → CLOSED; missing = AVAILABLE copies of the campus with no scan (snapshot). |
| POST | /stock-checks/:id/cancel | `reason`* | StockCheckView (ADMIN only) |
| POST | /stock-checks/:id/mark-lost | `copyIds`* (1–500, must be in `missing` and not yet marked), `reason`* | `{ marked: number, skipped: { copyId, catalogNumber, status }[] }`. CLOSED only. Per copy conditional `BookCopy.updateOne({_id, campusId, status:'AVAILABLE'}, {status:'LOST', lostAt, lostBy, lostReason, lostSource:'STOCK_CHECK', stockCheckId})` (bulkWrite); copies no longer AVAILABLE are skipped. Set `missing.$[m].markedLostAt` for marked ones. No charges. |
Access: campus staff or ADMIN for all except cancel.
```ts
type StockCheckView = { id; campus:{id,name,code}; status; note; startedBy:{id,name}; startedAt; closedBy; closedAt; cancelledBy; cancelledAt; cancelReason; scanCount; expectedCount; missing: {...}[] /* [] while OPEN */ };
type ScanView = { copyId; catalogNumber; title; statusAtScan; scannedBy:{id,name}; scannedAt };
```
Audit entity `StockCheck` (add to VALID_ENTITIES): start, close ("Closed stock check IG-1 — 1,204 scanned, 7 missing"), cancel, mark-lost ("Marked 5 copies lost from stock check IG-1 — reason: …", plus per-copy entries via logAuditMany on entity BookCopy). Scans are NOT audited individually.

Client: `/library/stock-check` page: if no open check → Start button + history list; open check → big catalog input (autofocus, Enter submits, clears, coloured result banner, audible-free), scan count, per-shelf progress table, recent scans with Undo, Close button (confirm modal). Closed check view → missing list with checkboxes, "Mark selected lost" (ReasonModal), Excel export of the missing list. Scanned-LOST copies show a "Mark found" action (calls `/copies/:id/found`).

---

## 6. Client — other changes
- **Sidebar** Library group: add Reports, Stock check, No-Dues.
- **Router**: `/library/reports`, `/library/stock-check`, `/library/stock-check/:id`, `/library/clearance` (all `libraryAccess`).
- **Desk / StudentLibrary**: open-loan rows get "Report lost" → modal showing late fine so far (from LoanView), price, editable lost charge (note required when changed), total due; Admin gets backdate fields like return. After success, offer "Collect payment" (existing CollectPaymentModal).
- **Return modal (Desk)**: Minor damage pre-fills `round2(price × 0.25)` when price known; amber hint "Above the suggested 25% of price (₹X)" when amount > 25%. Still submits.
- **BookDetail**: DAMAGED copy → "Mark repaired"; LOST copy → "Mark found" (both confirm modal with optional note). Show lost/found/repair info on the copy row.
- **StudentLibrary**: "No-Dues" button → `/library/clearance?reg=…`. Loan history shows LOST status (red badge) and found date.
- **Clearance page**: Reg Number input → green "No dues — print slip" or red list of pending items (this campus detailed, other campuses summary). Slip printed with `librarySlip.ts` pattern (~80mm): library name, "LIBRARY NO-DUES CERTIFICATE", student name, reg no, batch, reference, date/time, issued by, signature line.
- **StudentDetail** (SSI): deactivate flow per §2c; button for ADMIN too.
- Types go in hooks (`useLibrary`/`useCirculation`/new `useReports.ts`, `useStockCheck.ts`, `useClearance.ts`), following existing hook patterns (axios instance, `{ success, data }`).

## 7. Scripts & docs
- `scripts/library-indexes.js`: add StockCheck / StockCheckScan indexes; optional `{status:1, lostAt:-1}` on BookCopy is NOT needed (campusId_status covers it).
- Pure-function tests (existing test style) for: report date-range defaults, scan result classification, `duesFor` summarising (with fixed ledger input), and lost fine freeze (`fineBreakdown` with lostAt).
