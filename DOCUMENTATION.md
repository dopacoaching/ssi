# Student Success Index (SSI) — Project Documentation

## What It Is

SSI is an internal web application for tracking student academic performance across multiple batches. It is used exclusively by teachers and an admin — there is no public-facing interface.

The system records four types of data per student:

- **CE Records** — a monthly composite score (out of 20) covering theory marks, MCQ performance, attendance, and notebook status. These scores are automatically calculated based on the student's test results.
- **Weekly Tests** — subject-wise test scores entered by date
- **Monthly Tests** — subject-wise test scores entered by month/year
- **Remarks** — free-text notes per student, optionally flagged for admin attention

All data can be exported to Excel (.xlsx) or PDF at the individual student level and at the batch level.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| State | Redux Toolkit |
| Backend | Node.js + Express |
| ODM | Mongoose |
| Database | MongoDB Atlas |
| Auth | JWT in httpOnly cookies + bcrypt (saltRounds=12) |

---

## Roles

### Teacher
- Sees only the batches they are assigned to
- Can view and add data for students in those batches
- Cannot access admin pages

### Admin
- Has global access to all batches and students
- Can manage batches (create, rename, reassign)
- Can manage teacher accounts (create, edit, reset password, activate/deactivate)
- Can export data across entire batches

---

## CE Scoring Formula (server-side only)

CE scores are always computed on the server in `server/utils/ceScoring.js`. The frontend never calculates them.

### Theory (max 10 pts)
Each subject score = `(marks / maxMarks) × weight`

| Subject | Weight |
|---|---|
| Physics | ×2 |
| Chemistry | ×2 |
| Math | ×2 |
| Biology | ×2 |
| Language 1 | ×1 |
| Language 2 | ×1 |

### MCQ (max 5 pts)
Based on percentage scored:

| Percentage | Score |
|---|---|
| 75–100% | 5 |
| 60–74% | 4 |
| 40–59% | 3 |
| 20–39% | 2 |
| < 20% | 1 |

### Attendance (max 3 pts)

Attendance is graded on the number of **leave days** a student takes in the month.
The teacher first sets the **total working days** for the batch each month (once per
batch, on the Students page), then records each student's leave days.

| Leave days in month | Score |
|---|---|
| 0 | 3 |
| 1 | 2 |
| 2 | 1 |
| 3 or more | 0 |

A student with a **medical certificate** keeps full attendance (3 pts) regardless of
leave days taken. Working days and leave days are shown in each student's individual
report (and the student/parent portal), but are not included in the batch "All Marks" export.

### Notes (max 2 pts)

| Status | Score |
|---|---|
| Complete | 2 |
| Partial | 1 |
| Incomplete | 0 |

**Total CE = Theory + MCQ + Attendance + Notes (max 20)**

Color coding in the UI:
- Green: 15 and above
- Yellow: 10–14
- Red: below 10

---

## API Routes

All routes are prefixed with `/api`.

### Auth
| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/login` | Login with email + password |
| POST | `/api/auth/refresh` | Refresh JWT from cookie |
| POST | `/api/auth/logout` | Clear auth cookie |

### Students
| Method | Route | Description |
|---|---|---|
| GET | `/api/batches/:id/students` | Students in a specific batch |
| GET | `/api/batches/:id/report` | Full marks report for a batch (admin export) |
| GET | `/api/students/:id` | Single student detail |
| POST | `/api/students` | Create student (teacher only) |
| PATCH | `/api/students/:id` | Edit student name or roll number (teacher only) |
| DELETE | `/api/students/:id` | Soft-delete (sets isActive = false, teacher only) |

### CE Records
| Method | Route | Description |
|---|---|---|
| GET | `/api/students/:id/ce` | All CE records for a student |
| POST | `/api/students/:id/ce` | Create or update CE record for a month/year |

### Tests
| Method | Route | Description |
|---|---|---|
| GET | `/api/students/:id/weekly-tests` | Weekly test results |
| POST | `/api/students/:id/weekly-tests` | Add weekly test |
| GET | `/api/students/:id/monthly-tests` | Monthly test results |
| POST | `/api/students/:id/monthly-tests` | Add monthly test |

### Remarks
| Method | Route | Description |
|---|---|---|
| GET | `/api/students/:id/remarks` | All remarks |
| POST | `/api/students/:id/remarks` | Add remark |
| PATCH | `/api/students/:id/remarks/:rid/flag` | Toggle flagged status |

### Admin (Admin only)
| Method | Route | Description |
|---|---|---|
| GET | `/api/admin/batches` | All batches |
| POST | `/api/admin/batches` | Create batch |
| PATCH | `/api/admin/batches/:id` | Rename / update batch |
| GET | `/api/admin/teachers` | All teacher accounts |
| POST | `/api/admin/teachers` | Create teacher account |
| PATCH | `/api/admin/teachers/:id` | Update name, batch assignments, password, active status |
| GET | `/api/admin/students` | All students across all batches |

---

## How to Run

### Prerequisites
- Node.js 18+
- A MongoDB Atlas connection string
- A `.env` file in `server/` with:
  ```
  DATABASE_URL=mongodb+srv://...
  JWT_SECRET=your-secret
  JWT_REFRESH_SECRET=your-refresh-secret
  CLIENT_URL=http://localhost:5173
  PORT=5000
  ```

### Install dependencies
```bash
# Root (installs concurrently for running both)
npm install

# Server
cd server && npm install

# Client
cd client && npm install
```

### Run in development
```bash
# From the project root (runs both server and client)
npm run dev
```

This starts:
- Express API on `http://localhost:5000`
- Vite dev server on `http://localhost:5173`

### Run server only
```bash
cd server && npm run dev
```

### Build the client for production
```bash
cd client && npm run build
```

---

## Page-by-Page Guide

### Login (`/login`)
Enter email and password. JWT is stored in an httpOnly cookie — not accessible from JavaScript. On refresh, the app restores the session automatically via the `/api/auth/refresh` endpoint.

### Dashboard (`/`)
Shows all assigned batches as cards. Each card shows the batch name, year, number of students, and (for admin) which teachers are assigned. Clicking a card navigates to the student list for that batch.

### Students (`/students?batch=<id>`)
Lists all active students in the selected batch. Supports search by name or roll number. Includes:
- Add student form
- Export student list as Excel or PDF
- Click a student row to open their detail page

### Student Detail (`/students/:id`)
Four tabs:

**CE Records**
- Shows all monthly CE records with scores broken down into Theory, MCQ, Attendance, and Notes
- Filter by month and/or year
- "+ Update Attendance & Notes" opens the form to manage attendance, medical certificates, and notebook status. **Theory and MCQ marks are automatically computed from test results for the corresponding month.**
- Export filtered records to Excel or PDF (two-sheet Excel: Summary + Subject Marks)

**Weekly Tests**
- Lists test results by date and subject
- Filter by month/year
- "+ Add Weekly Test" form: date, subject, chapter (optional), marks, max marks
- Export to Excel or PDF

**Monthly Tests**
- Lists results by month/year and subject
- Filter by month/year
- "+ Add Monthly Test" form: month, year, subject, marks, max marks
- Export to Excel or PDF

**Remarks**
- Free-text notes with a category label (e.g. Behaviour, Academic, Attendance)
- Can be flagged — highlights the card with a red border
- Flag/Unflag toggle per remark
- Shows which teacher added the remark and when

### Admin — Batches (`/admin/batches`)
Admin only. Lists all batches with student count and assigned teachers. Inline edit for name and year. "+ New Batch" creates a batch.

### Admin — Teachers (`/admin/teachers`)
Admin only. Lists all teacher accounts with email, assigned batches, and active status. Actions per teacher:
- **Edit** — rename or change batch assignments
- **Reset PW** — set a new password via a modal
- **Deactivate / Activate** — revoke or restore login access (soft toggle, not deleted)

---

## Data Rules

| Rule | Detail |
|---|---|
| Students are never hard-deleted | Deactivate sets `isActive = false`; all records are preserved |
| CE scores computed server-side only | The frontend sends raw marks; the backend returns computed scores |
| Teachers are batch-scoped | Server rejects requests for students outside assigned batches |
| Passwords hashed with bcrypt | saltRounds = 12 |
| JWT in httpOnly cookies | Never stored in localStorage or accessible via JS |
| All inputs validated before DB writes | express-validator runs on every POST/PATCH route |

---

## Export Formats

| Export type | Excel | PDF |
|---|---|---|
| Student list (per batch) | Yes | Yes |
| CE records (per student) | Two sheets: Summary + Subject Marks | Two tables: Summary + Subject Marks |
| Weekly tests (per student) | Yes | Yes |
| Monthly tests (per student) | Yes | Yes |
| Full batch marks (Admin) | Three sheets: CE + Weekly + Monthly | Three tables in one document |
