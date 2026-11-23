# Library module — build status & decisions

PRD: `docs/DOPA_Library_System_PRD.pdf`. API contracts per phase: `docs/library/phase{1..4}-contract.md` (the code follows them, with the deviations noted below).

## Status (2026-11-23)
| Phase | State |
|---|---|
| 1 Foundations (campuses, Batch.campusId, LIBRARIAN role, Staff page, library scope, librarian isolation) | Built + reviewed + fixed. Uncommitted. |
| 2 Catalog (Book + BookCopy, per-campus counter, add/edit/withdraw/reinstate, bulk upload, 3×8 labels, search, history) | Built + reviewed + fixed. Uncommitted. |
| 3 Circulation (desk issue/return/renew, fine service IST, damaged return, backdating, overdue lists, slip) | Built + reviewed + fixed. Uncommitted. |
| 4 Fines & payments (payments/receipts, void, waivers, no-fine periods, daily cash summary) | Built + reviewed + fixed. Uncommitted. |
| 5 Lost/damaged, No-Dues + deactivation warning, dashboard widgets, reports (Excel/PDF), stock check | Built + reviewed + fixed. Uncommitted. Contract: `phase5-contract.md`. |

**2026-11-23:** end-to-end API test (144 checks, all roles, both campuses, phases 1–5 incl. the second code-review fixes) passed against a local MongoDB 8 replica set; scripts `library-indexes.js` and `seed-campuses.js` verified idempotent there. Not yet clicked through in a browser. Also: pure-function tests 6/6, client `tsc -b` + `vite build`.
**Note (2026-11-23):** during Phase 5 verification `scripts/library-indexes.js` was accidentally executed (it runs on `require`) against the DB in `server/.env` (Atlas `ssi`). All 35 library indexes now exist there. Index creation is additive; no documents were changed.

## Scripts (run from server/, dry-run first)
1. `node scripts/library-indexes.js [--dry-run]` — all library indexes (must run before go-live; several safety guarantees depend on these unique/partial indexes).
2. `node scripts/seed-campuses.js [--dry-run]` — creates IG-1/IG-2, tags batches by name.
3. `node scripts/library-reconcile-student-state.js [--dry-run]` — optional, recomputes per-student open-loan counters.

## Decisions made with the product owner
- LIBRARIAN sees only the Library section; server blocks LIBRARIAN from all existing SSI APIs (`blockLibrarian` in server/index.js). Teachers get library access via `libraryCampusId`.
- Role changes apply after token refresh (≤15 min) for non-library routes; library routes re-read the user from the DB.
- Admin + own-campus staff edit shelves/categories; library rules are GLOBAL (LibrarySettings), Admin-only. Categories start empty. Campus code immutable.
- Book (title-level) + BookCopy (per copy). Duplicates: warn, librarian chooses. Unknown categories/shelves auto-added. Labels A4 3×8 with "start at label".
- Withdraw needs reason, only from Available/Damaged; only Admin reinstates (restores previous status).
- Issue checks count loans/charges across ALL campuses; other campuses shown only as summaries. Loan keeps the copy's campus.
- Damaged return in Phase 3: Minor → DAMAGED (hand-entered charge), Major → WITHDRAWN (default charge = price).
- Backdating: Admin only, reason, ≤ 30 days. Slip: browser print ~80mm.
- Loans snapshot loanDays/finePerDay at issue. Fines computed server-side at read time in Asia/Kolkata days.
- Only fixed charges payable (no prepay of accruing fines). Allocation oldest-first, editable. Receipts `IG1-R-000001`, per campus, continuous, no gaps. Payment idempotency via requestId.
- Admin-only: approve/reject waivers, void payments, no-fine periods. No automatic refunds.
- No-fine period applies to any late days in range (past/open/future); returned loans tracked with `Loan.waivedRanges` to prevent double waiving.

- Phase 5: deactivation allowed for ADMIN and TEACHER (own batches); both see the library-dues warning and may proceed. Lost book found → copy AVAILABLE, charges untouched (waiver request if needed). Minor damage: client pre-fills 25% of price, soft warning above. Stock check: server-side, resumable, one OPEN per campus; mark-lost from stock check creates no charge. Overdue inside a no-fine period still blocks issuing. Own-campus staff may report lost / mark found / mark repaired.
- No-Dues requires zero open loans (even not-yet-overdue) and zero balance. Dashboard pending-fines `accruing` counts all open overdue loans (can differ from the Fines page totals, which only list students with fixed charges).

## Open questions
1. In-file duplicate rows in bulk upload become separate books (warning only) — OK?
2. Label stock: verify 70×37 mm grid on real sticker sheets.
3. Load check: receipts and returns serialize per campus (shared counter doc).
4. PRD: cash handover process (outside the app for now).
5. Known minor gaps (accepted): undo-scan racing a close can leave scanCount off by one; a copy scanned as ISSUED then returned shows ALREADY_SCANNED on re-scan; PDFs print "Rs." (jsPDF fonts lack ₹).

## Next steps
End-to-end test on a dev DB + browser (all phases), then commit.
