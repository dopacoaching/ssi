// Pure (no DB) validation + normalisation for the library catalog.
// Shared by single add/edit and bulk validate/import so rules never drift.

const { MAX_LIST_ENTRIES } = require('./validation');

const TEXT_MAX = 300;
const LIST_ENTRY_MAX = 100;       // category / shelf must fit in the campus lists
const COPIES_MIN = 1;
const COPIES_MAX = 200;
const YEAR_MIN = 1000;

const TEXT_FIELDS = ['author', 'category', 'publisher', 'edition', 'isbn', 'remarks'];
const FIELD_LABELS = {
  title: 'Title', author: 'Author', category: 'Category', publisher: 'Publisher',
  edition: 'Edition', isbn: 'ISBN', remarks: 'Remarks', shelfLocation: 'Shelf location',
};
const MAX_LEN = { category: LIST_ENTRY_MAX, shelfLocation: LIST_ENTRY_MAX };

const maxYear = () => new Date().getFullYear() + 1;

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// lower(collapse-spaces(title)) + '|' + lower(collapse-spaces(author)).
// The ONE place this normalisation lives.
const matchKey = (title, author) => `${collapse(title)}|${collapse(author)}`;

// Case-insensitive key used for category / shelf de-duplication (same rule as cleanStringList).
const listKey = (s) => String(s).trim().toLowerCase();

// Text value → { value } | { error }. Numbers (Excel cells) are stringified.
function cleanText(v, field, { required = false } = {}) {
  const label = FIELD_LABELS[field] || field;
  let s;
  if (v === undefined || v === null) s = '';
  else if (typeof v === 'string') s = v.trim();
  else if (typeof v === 'number' && Number.isFinite(v)) s = String(v);
  else return { error: `${label} must be text` };
  if (required && !s) return { error: `${label} is required` };
  const max = MAX_LEN[field] || TEXT_MAX;
  if (s.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return { value: s };
}

function cleanYear(v) {
  const msg = `Year must be between ${YEAR_MIN} and ${maxYear()}`;
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return { value: null };
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d{1,5}$/.test(v.trim())) n = Number(v.trim());
  else return { error: msg };
  if (!Number.isInteger(n) || n < YEAR_MIN || n > maxYear()) return { error: msg };
  return { value: n };
}

function cleanPrice(v) {
  const msg = 'Price must be a number ≥ 0';
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return { value: null };
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) n = Number(v.trim());
  else return { error: msg };
  if (!Number.isFinite(n) || n < 0) return { error: msg };
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { error: 'Price can have at most 2 decimal places' };
  return { value: Math.round(n * 100) / 100 };
}

// Absent → `fallback` (single add / bulk: 1), or an error when `required` (add-copies `count`).
function cleanCopies(v, { label = 'Copies', fallback = 1, required = false } = {}) {
  const msg = `${label} must be a whole number from ${COPIES_MIN} to ${COPIES_MAX}`;
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    return required ? { error: msg } : { value: fallback };
  }
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d{1,4}$/.test(v.trim())) n = Number(v.trim());
  else return { error: msg };
  if (!Number.isInteger(n) || n < COPIES_MIN || n > COPIES_MAX) return { error: msg };
  return { value: n };
}

// Validate book-level fields. `partial` (edit): only keys present in `input` are checked/returned.
// Returns { errors: string[], value: {...} }.
function validateBookFields(input, { partial = false } = {}) {
  const src = input || {};
  const errors = [];
  const value = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined;

  if (!partial || has('title')) {
    const r = cleanText(src.title, 'title', { required: true });
    if (r.error) errors.push(r.error); else value.title = r.value;
  }
  for (const f of TEXT_FIELDS) {
    if (partial && !has(f)) continue;
    const r = cleanText(src[f], f);
    if (r.error) errors.push(r.error); else value[f] = r.value;
  }
  if (!partial || has('year')) {
    const r = cleanYear(src.year);
    if (r.error) errors.push(r.error); else value.year = r.value;
  }
  if (!partial || has('price')) {
    const r = cleanPrice(src.price);
    if (r.error) errors.push(r.error); else value.price = r.value;
  }
  return { errors, value };
}

// Bulk rows (pure). `existing` = { categories: string[], shelfLocations: string[] } of the campus.
// Returns per-row { rowNumber, errors, duplicateInFile, clean, matchKey } plus totals and the
// categories/shelves that would be added. DB duplicates are layered on by the controller.
// Error text when `incoming` new values would push a campus list past MAX_LIST_ENTRIES.
function listCapacityError(existingList, incoming, label) {
  const seen = new Set((existingList || []).map(listKey));
  let added = 0;
  for (const v of incoming) {
    if (!v) continue;
    const k = listKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    added += 1;
  }
  if ((existingList || []).length + added > MAX_LIST_ENTRIES) {
    return `${label} list for this campus is full (${MAX_LIST_ENTRIES}). Remove unused entries in Library Settings first.`;
  }
  return null;
}

// Returns a function value → the campus list's existing spelling when it matches
// case-insensitively; first-seen spelling wins for brand-new values (stateful).
function canonicalizer(existingList) {
  const map = new Map((existingList || []).map((v) => [listKey(v), v]));
  return (value) => {
    if (!value) return value;
    const k = listKey(value);
    if (!map.has(k)) map.set(k, value);
    return map.get(k);
  };
}

// Bulk rows (pure). `existing` = { categories: string[], shelfLocations: string[] } of the campus.
// Rows are identified by array INDEX internally (client rowNumber is only for reporting, and
// falls back to index+2 when it is not a unique positive integer).
// Returns per-row { rowNumber, errors, duplicateInFile, clean, matchKey } plus totals, the
// categories/shelves that would be added, and top-level `errors` (e.g. campus list full).
// `existingBookRows` (Set of row indexes): rows resolved to an EXISTING book. Their copies keep
// the book's category, so their category is not collected (or counted against list capacity).
function validateBulkRows(rows, existing = {}, { existingBookRows = new Set() } = {}) {
  const out = [];
  const byKey = new Map(); // matchKey -> [index]
  const usedNumbers = new Set();
  let totalCopies = 0;

  rows.forEach((raw, i) => {
    const row = raw && typeof raw === 'object' ? raw : {};
    let rowNumber = row.rowNumber;
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || usedNumbers.has(rowNumber)) rowNumber = i + 2;
    usedNumbers.add(rowNumber);
    const errors = [];

    const { errors: fieldErrors, value } = validateBookFields(row);
    errors.push(...fieldErrors);

    const c = cleanCopies(row.copies);
    if (c.error) errors.push(c.error);
    const s = cleanText(row.shelfLocation, 'shelfLocation');
    if (s.error) errors.push(s.error);

    const clean = {
      ...value,
      copies: c.value ?? 1,
      shelfLocation: s.value ?? '',
    };
    const key = errors.length === 0 ? matchKey(clean.title, clean.author) : null;
    if (key !== null) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(i);
      totalCopies += clean.copies;
    }
    out.push({ rowNumber, errors, duplicateInFile: [], clean, matchKey: key });
  });

  out.forEach((r, i) => {
    if (r.matchKey === null) return;
    r.duplicateInFile = byKey.get(r.matchKey).filter((j) => j !== i).map((j) => out[j].rowNumber);
  });

  const collect = (existingList, pick, { skipExistingBooks = false } = {}) => {
    const seen = new Set((existingList || []).map(listKey));
    const added = [];
    for (const [i, r] of out.entries()) {
      if (r.errors.length) continue;
      if (skipExistingBooks && existingBookRows.has(i)) continue;
      const v = pick(r.clean);
      if (!v) continue;
      const k = listKey(v);
      if (seen.has(k)) continue;
      seen.add(k);
      added.push(v);
    }
    return added;
  };

  const newCategories = collect(existing.categories, (c) => c.category, { skipExistingBooks: true });
  const newShelves = collect(existing.shelfLocations, (c) => c.shelfLocation);
  const errors = [
    listCapacityError(existing.categories, newCategories, 'Category'),
    listCapacityError(existing.shelfLocations, newShelves, 'Shelf'),
  ].filter(Boolean);

  return { rows: out, totalRows: out.length, totalCopies, newCategories, newShelves, errors };
}

module.exports = {
  TEXT_MAX, LIST_ENTRY_MAX, COPIES_MIN, COPIES_MAX,
  matchKey, listKey, cleanText, cleanYear, cleanPrice, cleanCopies,
  validateBookFields, validateBulkRows, listCapacityError, canonicalizer,
};
