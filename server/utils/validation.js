// Small manual-validation helpers shared by library/campus controllers.

const MAX_LIST_ENTRIES = 500;
const MAX_ENTRY_LENGTH = 100;

// Trim, drop empties, case-insensitive de-dupe (first spelling wins).
// Returns { value } or { error }.
function cleanStringList(input, label) {
  if (!Array.isArray(input)) return { error: `${label} must be an array of strings` };
  const seen = new Set();
  const out = [];
  for (const item of input) {
    if (typeof item !== 'string') return { error: `${label} must be an array of strings` };
    const t = item.trim();
    if (!t) continue;
    if (t.length > MAX_ENTRY_LENGTH) return { error: `Each entry in ${label} must be ${MAX_ENTRY_LENGTH} characters or fewer` };
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  if (out.length > MAX_LIST_ENTRIES) return { error: `${label} can have at most ${MAX_LIST_ENTRIES} entries` };
  return { value: out };
}

module.exports = { cleanStringList, MAX_LIST_ENTRIES, MAX_ENTRY_LENGTH };
