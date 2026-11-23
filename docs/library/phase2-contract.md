# SSI Library — Phase 2 (Catalog) API contract

Builds on Phase 1 (see phase1-contract.md). Response shape `{ success, message, data }`. All routes under `/api/library`, guarded by `verifyToken` + `requireLibraryAccess` (server/middleware/libraryScope.js). Non-admin users are confined to `req.library.campusId`; any campusId in a body/query from a non-admin that differs → 403. Admin must send `campusId` for creates/uploads (400 if missing); for reads admin may omit campusId (= all campuses).

## Types

```ts
type CopyStatus = 'AVAILABLE' | 'ISSUED' | 'LOST' | 'DAMAGED' | 'WITHDRAWN';   // 'Overdue' is derived in Phase 3, never stored

type BookCopy = {
  id: string; campusId: string; bookId: string;
  catalogNumber: string;          // `${campus.code}-${String(seq).padStart(5,'0')}` e.g. IG1-00001; immutable
  seq: number;
  status: CopyStatus;
  shelfLocation: string;          // '' if none
  remarks: string;
  withdrawnAt: string | null; withdrawnBy: { id: string; name: string } | null; withdrawReason: string;
  createdAt: string; updatedAt: string;
};

type Book = {
  id: string; campusId: string;
  campus?: { id: string; name: string; code: string };   // included in list/detail responses
  title: string;                  // required, trimmed, <= 300
  author: string; category: string; publisher: string; edition: string; isbn: string; remarks: string; // '' default, <= 300 each
  year: number | null;            // int 1000..(current year + 1)
  price: number | null;           // >= 0, up to 2 decimals
  matchKey: string;               // server-only semantics: lower(collapse-spaces(title)) + '|' + lower(collapse-spaces(author)); still returned
  copyCounts: { total: number; AVAILABLE: number; ISSUED: number; LOST: number; DAMAGED: number; WITHDRAWN: number };
  copies?: BookCopy[];            // included in list (sorted by seq) and detail
  createdAt: string; updatedAt: string;
};

type HistoryEntry = {             // from audit_logs, entity Book (entityId = book.id) or BookCopy (entityId in book's copy ids)
  id: string; action: string; entity: 'Book' | 'BookCopy'; entityId: string;
  description: string; userName: string; userRole: string; createdAt: string;
};
```

## Endpoints

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | /books | `q` (matches catalogNumber (case-insensitive prefix/exact, e.g. "ig1-00012" or "00012"), title, author, category, shelfLocation of any copy, isbn), `status` (CopyStatus; books having ≥1 copy in it), `category`, `shelf`, `campusId` (admin only), `page` (1-based, default 1), `limit` (default 25, max 100) | `{ items: Book[] (with copies, campus), total, page, limit }` sorted by title asc |
| GET | /books/similar | `title`*, `author`, `campusId` (admin required) | `Book[]` (max 10, same campus) whose matchKey equals, or title matches case-insensitive contains |
| GET | /books/:id | – | `{ book: Book (with copies, campus), history: HistoryEntry[] (newest first, max 200) }` |
| POST | /books | `campusId` (admin only, required for admin), `title`*, author, category, publisher, edition, year, isbn, price, remarks, `copies` (int 1–200, default 1), `shelfLocation`, `copyRemarks` | 201 `{ book: Book, copies: BookCopy[] (the new ones) }`. New category/shelf values are added to the campus lists (case-insensitive de-dupe) |
| POST | /books/:id/copies | `count` (1–200)*, shelfLocation, remarks | 201 `{ book: Book, copies: BookCopy[] (new) }` |
| PATCH | /books/:id | any of title, author, category, publisher, edition, year, isbn, price, remarks | Book. Audit description lists `field: "old" → "new"`. New category added to campus list |
| PATCH | /copies/:id | shelfLocation, remarks | BookCopy. New shelf added to campus list |
| POST | /copies/:id/withdraw | `reason`* (<= 300) | BookCopy. Only from AVAILABLE or DAMAGED, else 400 "Only available or damaged copies can be withdrawn". Must be atomic: findOneAndUpdate({ _id, status: {$in:[AVAILABLE,DAMAGED]} }) |
| POST | /copies/:id/reinstate | – | BookCopy. ADMIN only (403 otherwise). Only from WITHDRAWN → AVAILABLE (atomic conditional update) |
| POST | /books/bulk/validate | `campusId` (admin required), `rows: BulkRow[]` (1–1000) | `BulkValidation` |
| POST | /books/bulk/import | `campusId` (admin required), `rows: BulkRow[]` with `resolution` per row | 201 `{ createdBooks: number, addedToExisting: number, copies: (BookCopy & { title: string })[] (all new copies, by seq), addedCategories: string[], addedShelves: string[] }` |

```ts
type BulkRow = {
  rowNumber: number;              // Excel row number (for messages)
  title: string; author?: string; category?: string; publisher?: string; edition?: string;
  year?: number | string | null; isbn?: string; price?: number | string | null; remarks?: string;
  copies?: number | string;       // default 1, int 1–200
  shelfLocation?: string;
  resolution?: { mode: 'new' } | { mode: 'existing'; bookId: string };  // import only; required for rows flagged duplicate, default 'new'
};

type BulkValidation = {
  valid: boolean;                 // no row errors
  totalRows: number; totalCopies: number;
  rows: {
    rowNumber: number;
    errors: string[];             // e.g. "Title is required", "Copies must be a whole number from 1 to 200", "Price must be a number ≥ 0", "Year must be between 1000 and 2027"
    duplicates: { id: string; title: string; author: string; copyCount: number }[];  // existing books in campus with same matchKey
    duplicateInFile: number[];    // other rowNumbers in this file with the same matchKey
  }[];
  newCategories: string[]; newShelves: string[];
};
```

Import rules: server re-validates everything (any row error → 400 with `{ message, data: BulkValidation }`), resolution `existing` bookId must belong to the same campus. Writes (books, copies, campus list additions) in ONE MongoDB transaction (mongoose session + withTransaction). Catalog numbers reserved BEFORE the transaction via a single atomic `$inc` of `total copies` on the campus counter (gaps on failure are acceptable; numbers are never reused). Audit: one entry per created book + one per existing book that got copies + one summary entry on entity 'Campus', inserted via a batched helper.

## Counter
Collection `LibraryCounter` `{ campusId (unique), seq }`. `reserve(campusId, n)` = `findOneAndUpdate({campusId}, {$inc:{seq:n}}, {upsert:true, new:true})` → returns numbers `seq-n+1 .. seq`. Same helper for single add, add-copies and bulk.

## Audit
Entities `Book`, `BookCopy` (add to auditController VALID_ENTITIES). Actions stay within existing VALID_ACTIONS (CREATE / UPDATE); withdraw/reinstate are UPDATE with descriptive text ("Withdrew IG1-00012 — reason: …").

## Indexes (schemas AND scripts/library-indexes.js INDEX_SPECS)
- BookCopy `{campusId:1, catalogNumber:1}` unique name `campusId_catalogNumber`
- BookCopy `{bookId:1}`; BookCopy `{campusId:1, status:1}`
- Book `{campusId:1, matchKey:1}`; Book `{campusId:1, title:1}`
- LibraryCounter `{campusId:1}` unique name `campusId_counter`
errorHandler: map duplicate on catalogNumber to "Catalog number already exists — please retry".
