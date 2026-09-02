// Lightweight typed errors. `errorHandler` reads `.status` and (outside a
// masked 500) surfaces `.message`, so throwing one of these from a model or
// controller yields a clean JSON response instead of a null-deref 500.

class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

// Wraps the result of a mutation wrapper (findByIdAndUpdate / findByIdAndDelete):
// the old Prisma layer threw P2025 → 404 when the row was gone; Mongoose just
// returns null, which callers then dereference. Restore the 404.
const orNotFound = (label) => (doc) => {
  if (doc == null) throw new NotFoundError(`${label} not found`);
  return doc;
};

module.exports = { NotFoundError, orNotFound };
