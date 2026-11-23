# SSI Library — Phase 3 (Circulation) API contract

Builds on phase1/phase2 contracts (same folder). Response shape `{ success, message, data }`. Routes under `/api/library`, guarded by verifyToken + requireLibraryAccess. Non-admins confined to `req.library.campusId`; admin must send `campusId` for issue (desk campus) and may filter lists by campusId (omit = all).

## Date & fine rules (server/services/fineService.js — PURE, unit-tested)
- All calendar maths in Asia/Kolkata. Helper `istDate(d: Date): 'YYYY-MM-DD'`, `addDays(ymd, n)`, `diffDays(aYmd, bYmd)`.
- `dueDate = addDays(istDate(issuedAt), loanDays)`.
- `daysLate(loan, asOf) = max(0, diffDays(istDate(endAt), loan.dueDate))` where endAt = returnedAt ?? lostAt ?? asOf (now).
- `lateFine = daysLate * loan.finePerDay` (loan stores loanDays/finePerDay snapshot from LibrarySettings at issue time). Phase 4 will subtract waived days/amounts — keep the function shaped to accept that later (e.g. `waivedAmount` default 0, never below 0).
- Overdue ⇔ loan OPEN && istDate(now) > dueDate.
- Renewal allowed ⇔ OPEN && renewCount < settings.maxRenewals (from settings at renewal time) && istDate(now) <= dueDate. New dueDate = addDays(istDate(now), loan.loanDays). Not affected by backdating.
- PRD examples that MUST pass: issued 1 Dec → due 15 Dec; returned 14 Dec → 0; 15 Dec → 0; 16 Dec → 1 (₹1); 25 Dec → 10; renewed 10 Dec → due 24 Dec, returned 30 Dec → 6.

## Collections
```ts
Loan {                                  // collection 'Loan'
  campusId; copyId; bookId; studentId;  // campusId = copy's campus (never the student's)
  issuedAt: Date; issuedBy: ObjectId(User);
  dueDate: string /*YYYY-MM-DD IST*/;
  loanDays: number; finePerDay: number; // snapshot
  renewCount: number;                   // default 0
  renewals: [{ at: Date; by: ObjectId; previousDueDate: string; newDueDate: string }];
  status: 'OPEN' | 'RETURNED' | 'LOST'; // LOST used in Phase 5
  returnedAt: Date|null; returnedBy: ObjectId|null;
  condition: null | 'GOOD' | 'DAMAGED_MINOR' | 'DAMAGED_MAJOR';
  fineDays: number|null; fineAmount: number|null;   // frozen at close
  backdated: { issue?: { reason, by, at }, return?: { reason, by, at } } | null;
}
Charge {                                // collection 'Charge'
  campusId; studentId; loanId; copyId;
  type: 'LATE' | 'DAMAGE' | 'LOST';
  amount: number;                       // >= 0, 2 decimals
  paidAmount: number /*0*/; waivedAmount: number /*0*/;   // Phase 4
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'WAIVED';       // derived & stored; 'UNPAID' at creation (or 'PAID' if amount 0? → do NOT create zero-amount charges, except DAMAGE with amount 0 which is skipped too)
  note: string; createdBy: ObjectId;
}
LibraryStudentState { studentId (unique); openLoans: number }  // collection 'LibraryStudentState'
```
Indexes (schemas AND scripts/library-indexes.js): Loan `{copyId:1}` unique partial `{status:'OPEN'}` name `copyId_open_unique`; Loan `{studentId:1,status:1}`; Loan `{campusId:1,status:1,dueDate:1}`; Loan `{bookId:1, issuedAt:-1}`; Charge `{studentId:1,status:1}`; Charge `{campusId:1,status:1}`; Charge `{loanId:1}`; LibraryStudentState `{studentId:1}` unique.

Outstanding(student) = Σ over charges (amount − paidAmount − waivedAmount, ≥0) + Σ live lateFine of OPEN loans. Computed at read time, across ALL campuses.

## Eligibility (issue) — reasons, all evaluated, in this order
1. `STUDENT_NOT_FOUND` "No student with this Reg Number" / `NOT_THIS_CAMPUS` "This student's batch is not in <campus>" (student's campus = batch.campusId; must equal desk campus).
2. `INACTIVE` "Student is inactive".
3. `LIMIT` "Already holds 2 books" (open loans across ALL campuses ≥ settings.maxBooks).
4. `OVERDUE` "Has an overdue book" (any campus; for other campuses don't reveal title).
5. `DUES` "Unpaid charges ₹X exceed the ₹50 limit" (outstanding > settings.fineBlockThreshold — strictly greater).
Copy-level: `COPY_NOT_FOUND` (in this campus), `COPY_NOT_AVAILABLE` "Copy is <status>" (ISSUED → include "due <date>" if same campus).

## Endpoints (/api/library/circulation)
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | /student/:regNumber | `campusId` (admin: desk campus, required) | `StudentCard` |
| GET | /copy/:catalogNumber | `campusId` (admin optional; catalogNumber is unique per campus but code prefix identifies campus — resolve by exact catalogNumber within allowed campuses) | `CopyCard` |
| POST | /issue | `regNumber`*, `catalogNumber`*, `campusId` (admin*), `issuedAt` (ISO, ADMIN only, ≤ now, ≥ now−30 days), `reason` (required when issuedAt given) | 201 `{ loan: LoanView, student: StudentCard }`. 400 `{ message, data: { reasons: Reason[] } }` when not eligible |
| POST | /return | `catalogNumber`*, `condition`* 'GOOD'|'DAMAGED', `severity` 'MINOR'|'MAJOR' (required if DAMAGED), `charge` (number ≥0; DAMAGED only; MAJOR defaults to book price if omitted, else required), `returnedAt` (ADMIN only, ≥ issuedAt, ≤ now, ≥ now−30d), `reason` | `{ loan: LoanView, charges: ChargeView[] (created), student: { id, fullName, regNumber, outstanding } }` |
| POST | /renew | `loanId`* | `{ loan: LoanView }` 400 with reason if not allowed ("Already renewed once", "Overdue books cannot be renewed") |
| GET | /loans | `view`* 'open'|'overdue'|'dueToday'|'dueSoon' (dueSoon = due in next 1–2 days, i.e. today < dueDate ≤ today+2), `campusId` (admin optional), `q` (reg number / name / catalog number), `page`, `limit` (≤100) | `{ items: LoanView[], total, page, limit }`; overdue sorted daysLate desc, others dueDate asc |
| GET | /students/:studentId/history | – | `{ student: StudentCard['student'], loans: LoanView[] (this campus for non-admin; all for admin, newest first), charges: ChargeView[] (same scoping), otherCampuses: OtherCampusSummary | null }` |

Copy return/renew must be allowed by staff of the COPY's campus (loan.campusId), even if the student moved to another campus. Student lookup for non-admin: allowed if student's batch campus = own campus OR student has an OPEN loan or outstanding charge at own campus (then `NOT_THIS_CAMPUS` still blocks issuing).

```ts
type Reason = { code: string; message: string };
type LoanView = {
  id; campusId; campus: {id,name,code};
  copy: { id; catalogNumber; status }; book: { id; title; author };
  student: { id; fullName; regNumber; batch: {id,name} | null };
  issuedAt; issuedBy: {id,name}; dueDate; renewCount; renewals; status; returnedAt; returnedBy: {id,name}|null; condition;
  daysLate: number; lateFine: number;   // live for OPEN, frozen for closed
  isOverdue: boolean; canRenew: boolean; renewBlockedReason: string | null;
  backdated;
};
type ChargeView = { id; campusId; type; amount; paidAmount; waivedAmount; balance; status; note; loanId; copy: {id, catalogNumber}; book: {id,title}; createdAt; createdBy: {id,name} };
type OtherCampusSummary = { openLoans: number; overdueLoans: number; outstanding: number; campuses: string[] /*codes*/ };
type StudentCard = {
  student: { id; fullName; regNumber; photo; isActive; batch: {id,name}|null; campus: {id,name,code}|null };
  loans: LoanView[];                 // OPEN loans at the desk/own campus (admin: desk campus)
  charges: ChargeView[];             // unpaid/partial at own campus
  otherCampuses: OtherCampusSummary | null;
  outstanding: { thisCampus: number; total: number };
  eligibility: { canIssue: boolean; reasons: Reason[] };
  settings: { maxBooks; fineBlockThreshold; loanDays };
};
type CopyCard = { copy: BookCopy; book: { id; title; author; price }; campus; openLoan: LoanView | null };
```

## Atomicity
- Issue: ONE transaction: (a) `BookCopy.findOneAndUpdate({_id, campusId, status:'AVAILABLE'}, {status:'ISSUED'})` — null → COPY_NOT_AVAILABLE; (b) ensure LibraryStudentState exists (upsert `$setOnInsert:{openLoans: <actual open count>}` BEFORE the transaction), then inside txn `findOneAndUpdate({studentId, openLoans:{$lt: maxBooks}}, {$inc:{openLoans:1}})` — null → LIMIT; (c) re-check OVERDUE and DUES inside txn with session reads; (d) insert Loan. Any failure → abort, 400 with reason. withTransaction callback must be retry-safe (no audit/side effects inside).
- Return: ONE transaction: Loan `findOneAndUpdate({_id, status:'OPEN'}, {...closed fields})`; copy ISSUED → AVAILABLE | DAMAGED (minor) | WITHDRAWN (major, withdrawReason "Major damage on return", withdrawnBy, statusBeforeWithdraw null); `$inc openLoans -1` (not below 0); insert LATE charge if fine > 0 and DAMAGE charge if charge > 0.
- Renew: conditional `findOneAndUpdate({_id, status:'OPEN', renewCount:{$lt:max}, dueDate:{$gte: todayIST}}, {$set:{dueDate:new}, $inc:{renewCount:1}, $push:{renewals}})`.
- Audit after commit, awaited (Vercel). Entities `Loan`, `Charge` (add to VALID_ENTITIES). Descriptions human-readable: "Issued IG1-00012 "Title" to 23R1045 (Name), due 2026-12-07", "Returned … 3 days late, fine ₹3", "Renewed … new due …", backdate reasons included.

## Catalog additions (Phase 2 endpoints)
BookCopy in GET /books and GET /books/:id gains `loan: { id, dueDate, isOverdue, daysLate, student: { id, fullName, regNumber } } | null` for ISSUED copies (student info only if caller may see that campus — always true since copies are campus-scoped). GET /books/:id gains `loans: LoanView[]` (newest first, max 200).
