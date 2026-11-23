# SSI Library — Phase 1 API contract (shared by server + client agents)

All responses use server/views/response.js shape: `{ success, message, data }` (errors: `{ success:false, message }`).
IDs are strings (normalize()).

## Types

```ts
type Campus = {
  id: string; name: string;            // e.g. "IG-1" (unique, case-insensitive check)
  code: string;                        // e.g. "IG1" — uppercase A-Z0-9, 2–6 chars, unique, IMMUTABLE after create
  libraryName: string; receiptAddress: string; receiptPhone: string; openingHours: string; // default ''
  shelfLocations: string[]; categories: string[];   // default [] (categories start EMPTY)
  isActive: boolean; createdAt: string; updatedAt: string;
  batches?: { id: string; name: string; year: number }[];  // only on GET /api/admin/campuses (active batches tagged with this campus)
};

type LibrarySettings = {               // single global doc, auto-created with defaults on first read
  loanDays: number;          // default 14, int 1–365
  finePerDay: number;        // default 1, number >= 0
  maxBooks: number;          // default 2, int 1–20
  maxRenewals: number;       // default 1, int 0–10
  fineBlockThreshold: number;// default 50, number >= 0
  updatedAt: string;
};

type Staff = {
  id: string; email: string; name: string;
  role: 'TEACHER' | 'LIBRARIAN';
  batchIds: string[];                  // always [] for LIBRARIAN
  libraryCampusId: string | null;      // required for LIBRARIAN; optional for TEACHER (= library access)
  libraryCampus: { id: string; name: string; code: string } | null;
  isActive: boolean; createdAt: string;
};

// AuthUser (login + refresh response, and JWT payload) gains:
//   role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'LIBRARIAN'
//   libraryCampusId: string | null
// Batch objects (GET /api/batches, /api/admin/batches, create/update responses) gain:
//   campusId: string | null; campus: { id, name, code } | null
```

## Admin endpoints (verifyToken + requireRole('ADMIN'))

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | /api/admin/campuses | – | Campus[] (all, incl. inactive, with `batches`) sorted by name |
| POST | /api/admin/campuses | name*, code*, libraryName, receiptAddress, receiptPhone, openingHours, shelfLocations, categories | 201 Campus |
| PATCH | /api/admin/campuses/:id | any of the above except code, plus isActive:boolean | Campus. `code` present & different → 400 "Campus code cannot be changed". Deactivating a campus that still has active batches or active staff with that libraryCampusId → 400 with explanation |
| GET | /api/admin/library-settings | – | LibrarySettings |
| PATCH | /api/admin/library-settings | partial LibrarySettings | LibrarySettings |
| GET | /api/admin/staff | – | Staff[] (roles TEACHER + LIBRARIAN only) |
| POST | /api/admin/staff | name*, email*, password* (>=8), role* ('TEACHER'|'LIBRARIAN'), batchIds (TEACHER only), libraryCampusId (required if LIBRARIAN, optional TEACHER) | 201 Staff |
| PATCH | /api/admin/staff/:id | name, role, batchIds, libraryCampusId (string or null), isActive, password | Staff. Target must be TEACHER/LIBRARIAN else 404. Resulting LIBRARIAN must have a campus (400). Switching to LIBRARIAN clears batchIds; sending non-empty batchIds for a LIBRARIAN → 400. Campus must exist and be active |
| POST | /api/admin/batches | name*, year*, campusId* | existing behaviour + campus required/validated |
| PATCH | /api/admin/batches/:id | existing fields + campusId | campusId if present must be a valid existing campus; null/'' → 400 "Campus is required" |

Existing /api/admin/teachers endpoints stay untouched.

## Library endpoints (verifyToken + requireLibraryAccess)

`requireLibraryAccess`: re-reads User from DB each request (fresh). Allow if role ADMIN, or (isActive && libraryCampusId set && that campus isActive). Else 403. Sets `req.library = { isAdmin: boolean, campusId: string|null }` (null for admin).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | /api/library/me | – | `{ isAdmin, campus: Campus|null (own campus; null for admin), campuses: Campus[] (admin: all active; others: [own]), settings: LibrarySettings }` |
| GET | /api/library/campuses | – | Campus[] scoped (active only) |
| PATCH | /api/library/campuses/:id/catalog-settings | shelfLocations?: string[], categories?: string[] | Campus. Non-admin may only edit own campus (403). Strings trimmed, empties dropped, case-insensitive de-duplicated (keep first spelling), each <= 100 chars, <= 500 entries |

## LIBRARIAN isolation
A LIBRARIAN calling any existing non-library, non-auth API (students, ce, tests, remarks, admin, batches) → 403 "Library staff cannot access this resource". TEACHER/ADMIN/STUDENT behaviour unchanged.

## Audit entities
New audit entity names: `Campus`, `LibrarySettings`; staff writes use entity `User`.
