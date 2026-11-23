# SSI Library — Phase 4 (Fines & payments) API contract

Builds on phase1–3 contracts (same folder). Response `{ success, message, data }`. Routes under `/api/library`, verifyToken + requireLibraryAccess. Non-admins confined to own campus (by the charge's / payment's / loan's campusId). ADMIN-only endpoints enforced server-side (403 otherwise). Money: numbers with ≤ 2 decimals, always round2; never negative. Times: Asia/Kolkata calendar days for any "date" parameter (YYYY-MM-DD).

## Fine rule update (server/services/fineService.js)
- New pure fn `periodOverlapDays(fromExclusiveYmd, toInclusiveYmd, periods[{from,to}])` = number of distinct calendar days d with fromExclusive < d ≤ toInclusive that fall inside ANY period (merge overlapping periods; count each day once).
- `daysLate` unchanged (raw). New `chargeableDays(loan, asOf, periods) = max(0, rawDaysLate − periodOverlapDays(loan.dueDate, endYmd, periods))`. `lateFine = chargeableDays × loan.finePerDay`.
- Periods = active (not cancelled) FinePeriods of the LOAN's campusId. Used for: live fines (views, lists, outstanding, eligibility) and the frozen fine at return. Load once per request per campus (batched).
- LoanView gains `waivedDays: number` (overlap days) in addition to daysLate (raw) and lateFine (chargeable × rate). Loan document at close also stores `fineWaivedDays`.

## Collections
```ts
Payment {                     // collection 'Payment' — immutable except `voided`
  campusId; studentId;
  receiptNumber: string;      // `${campus.code}-R-${String(n).padStart(6,'0')}`, per campus, continuous
  receiptSeq: number;
  amount: number;             // = Σ allocations.amount, > 0
  allocations: [{ chargeId; amount }];
  receivedBy: ObjectId(User); receivedAt: Date; note: string;
  voided: { at: Date; by: ObjectId; reason: string } | null;
}
Waiver {                      // collection 'Waiver'
  campusId; studentId; chargeId;
  type: 'REQUEST' | 'DIRECT' | 'BULK';
  amount: number;             // requested amount (REQUEST) / applied amount (DIRECT, BULK, and APPROVED requests store approvedAmount)
  approvedAmount: number | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy; requestedAt; decidedBy | null; decidedAt | null; decisionNote: string;
  finePeriodId: ObjectId | null;   // BULK only
}
FinePeriod {                  // collection 'FinePeriod'
  campusId; from: 'YYYY-MM-DD'; to: 'YYYY-MM-DD' (inclusive, from ≤ to, span ≤ 366 days);
  reason: string; createdBy;
  cancelled: { at; by; reason } | null;
}
// LibraryCounter gains `receiptSeq: number` (same doc as catalog `seq`, per campus).
```
Charge.status derivation (store it on every change): balance = round2(amount − paidAmount − waivedAmount). balance > 0 && paid+waived == 0 → UNPAID; balance > 0 → PARTIAL; balance == 0 && paidAmount > 0 → PAID; balance == 0 → WAIVED. Do it with an aggregation-pipeline update so it's atomic with the $inc.

Indexes (schemas AND scripts/library-indexes.js): Payment `{campusId:1, receiptNumber:1}` unique name `campusId_receiptNumber`; Payment `{campusId:1, receivedAt:-1}`; Payment `{receivedBy:1, receivedAt:-1}`; Payment `{studentId:1, receivedAt:-1}`; Payment `{'allocations.chargeId':1}`; Waiver `{campusId:1, status:1, requestedAt:-1}`; Waiver `{chargeId:1}`; Waiver `{finePeriodId:1}`; FinePeriod `{campusId:1, from:1}`.

## Rules
- Payment (ONE transaction, receipt counter $inc INSIDE the transaction so aborted payments leave no gap): for each allocation, conditional update on Charge `{_id, campusId: payment campus, studentId, balance ≥ alloc}` (use $expr) with pipeline `$inc paidAmount` + status recompute. Any miss → abort, 400 "Charge <catalog/type> has only ₹X left to pay". All charges must belong to the same student AND the same campus as the payment. amount must equal Σ allocations (±0.001). No duplicate chargeIds. 1–50 allocations.
- Void (ADMIN, reason*): ONE transaction: conditional `Payment.findOneAndUpdate({_id, voided:null}, {voided})`, then for each allocation `$inc paidAmount: −alloc` (never below 0) + status recompute. Receipt number stays used.
- Waiver REQUEST (any library staff of the charge's campus; ADMIN creating → DIRECT, applied immediately): amount > 0 and ≤ current balance at request time; one PENDING request per charge at a time (400 otherwise); reason* (≤ 500).
- Approve (ADMIN): optional `amount` ≤ requested; ONE transaction: conditional `Waiver.findOneAndUpdate({_id, status:'PENDING'})` → APPROVED, apply `min(amount, current balance)` to Charge.waivedAmount (conditional on balance > 0; if balance is 0 → 400 "Nothing left to waive", waiver stays PENDING). approvedAmount stores the applied amount. Reject (ADMIN, note*): PENDING → REJECTED.
- FinePeriod create (ADMIN, campusId*, from*, to*, reason*): insert period, then in ONE transaction create BULK waivers for every RETURNED loan of that campus with a LATE charge whose late window (dueDate, returnedAt-IST-date] overlaps the period: waiverAmount = min(overlapDays_newPeriodOnly_not_already_covered_by_other_active_periods × loan.finePerDay, charge balance); skip if 0. Apply to Charge.waivedAmount with status recompute. Response includes `{ period, appliedWaivers: n, totalWaived, paidNotRefunded: amount that could not be waived because already paid }`.
  - `GET /fine-periods/preview?campusId&from&to` returns the same numbers without writing + `openLoansAffected` count.
- FinePeriod cancel (ADMIN, reason*): sets `cancelled`; affects only live fines of loans not yet returned; existing BULK waivers stay.
- Periods may be in the past or future; overlapping periods allowed (days counted once).

## Endpoints
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | /fines/pending | `campusId` (admin opt.), `q` (reg/name), `page`, `limit≤100` | `{ items: { student: {id, fullName, regNumber, batch, isActive}, campus, balance, chargeCount, oldestChargeAt, accruing: number /* live fines on open loans at this campus */ }[], total, page, limit, totals: { balance, accruing } }` sorted balance desc |
| GET | /fines/students/:studentId | `campusId` (admin: required) | `{ student, charges: ChargeView[] (balance > 0, oldest first), accruing: LoanView[] (open overdue loans at this campus), balance }` |
| POST | /payments | `studentId`*, `campusId` (admin*), `amount`*, `allocations`*, `note` | 201 `{ payment: PaymentView }` |
| GET | /payments | `campusId` (admin opt.), `from`,`to` (YYYY-MM-DD IST, default today), `staffId`, `studentId`, `includeVoided` (default true), `page`, `limit≤100` | `{ items: PaymentView[], total, page, limit }` newest first |
| GET | /payments/:id | – | `PaymentView` (for reprint) |
| POST | /payments/:id/void | `reason`* | `PaymentView` (ADMIN) |
| GET | /payments/summary | `date` (default today IST), `campusId` (admin opt.) | `{ date, campus|null, myTotal, myCount, campusTotal, campusCount, byStaff: { staff:{id,name}, total, count }[] (ADMIN: all staff; others: all staff at own campus), payments: PaymentView[] }` — voided payments excluded from totals but listed with flag |
| POST | /waivers | `chargeId`*, `amount`*, `reason`* | 201 `WaiverView` (PENDING, or APPROVED/DIRECT for admin) |
| GET | /waivers | `status`, `campusId` (admin opt.), `mine` (bool), `page`, `limit` | `{ items: WaiverView[], total, page, limit }` |
| POST | /waivers/:id/approve | `amount`, `note` | WaiverView (ADMIN) |
| POST | /waivers/:id/reject | `note`* | WaiverView (ADMIN) |
| GET | /fine-periods | `campusId` (admin opt.; non-admin = own) | FinePeriodView[] newest first |
| GET | /fine-periods/preview | `campusId`*, `from`*, `to`* | `{ returnedLoansAffected, totalWaivable, paidNotRefunded, openLoansAffected }` (ADMIN) |
| POST | /fine-periods | `campusId`*, `from`*, `to`*, `reason`* | 201 `{ period, appliedWaivers, totalWaived, paidNotRefunded }` (ADMIN) |
| POST | /fine-periods/:id/cancel | `reason`* | FinePeriodView (ADMIN) |

```ts
type PaymentView = {
  id; receiptNumber; campus: {id,name,code,libraryName,receiptAddress,receiptPhone,openingHours};
  student: {id, fullName, regNumber, batch: {id,name}|null};
  amount; note; receivedAt; receivedBy: {id,name};
  allocations: { chargeId; amount; charge: { type; amount; catalogNumber; title; daysLate: number|null /* from loan fineDays for LATE */ } }[];
  voided: { at; by: {id,name}; reason } | null;
};
type WaiverView = { id; type; status; amount; approvedAmount; reason; decisionNote; campus:{id,name,code}; student:{id,fullName,regNumber}; charge: ChargeView; requestedBy:{id,name}; requestedAt; decidedBy:{id,name}|null; decidedAt; finePeriodId };
type FinePeriodView = { id; campus:{id,name,code}; from; to; reason; createdBy:{id,name}; createdAt; cancelled: {at; by:{id,name}; reason} | null; waiverCount: number; totalWaived: number };
```

## Audit (awaited, after commit)
Entities `Payment`, `Waiver`, `FinePeriod` (add to VALID_ENTITIES). Readable: "Received ₹30 from 23R1045 (Name) — receipt IG1-R-000012 (2 charges)", "Voided receipt IG1-R-000012 — reason: …", "Requested waiver ₹10 on LATE charge IG1-00012 — reason: …", "Approved waiver ₹10 …", "Created no-fine period IG-1 2026-12-20 → 2027-01-02 (reason) — 14 charges waived, ₹96", bulk waivers via logAuditMany.

## Existing endpoints
- StudentCard / history / loans lists use the new fine rule. History gains `payments: PaymentView[]` and `waivers: WaiverView[]` (same scoping).
- Return response unchanged in shape; LATE charge uses chargeable days.
