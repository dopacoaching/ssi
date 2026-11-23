const { Payment, Charge, BookCopy, Book, Loan, Student, Batch, User, normalize } = require('./schemas');
const campusModel = require('./campusModel');

const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];

const findById = (id, { session } = {}) => Payment.findById(id).session(session || null).lean();

// PaymentView[] for raw lean payments; every relation stitched with batched queries.
const shapeMany = async (docs) => {
  if (docs.length === 0) return [];
  const chargeIds = uniq(docs.flatMap((d) => (d.allocations || []).map((a) => a.chargeId)));
  const [campuses, students, users, charges] = await Promise.all([
    campusModel.findByIds(uniq(docs.map((d) => d.campusId))),
    Student.find({ _id: { $in: uniq(docs.map((d) => d.studentId)) } }).select('fullName regNumber batchId').lean(),
    User.find({ _id: { $in: uniq(docs.flatMap((d) => [d.receivedBy, d.voided?.by])) } }).select('name').lean(),
    Charge.find({ _id: { $in: chargeIds } }).select('type amount copyId loanId').lean(),
  ]);
  const [batches, copies, loans] = await Promise.all([
    Batch.find({ _id: { $in: uniq(students.map((s) => s.batchId)) } }).select('name').lean(),
    BookCopy.find({ _id: { $in: uniq(charges.map((c) => c.copyId)) } }).select('catalogNumber bookId').lean(),
    Loan.find({ _id: { $in: uniq(charges.filter((c) => c.type === 'LATE').map((c) => c.loanId)) } })
      .select('fineDays fineWaivedDays').lean(),
  ]);
  const books = await Book.find({ _id: { $in: uniq(copies.map((c) => c.bookId)) } }).select('title').lean();

  const campusById = new Map(campuses.map((c) => [String(c.id), c]));
  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const batchById = new Map(batches.map((b) => [String(b._id), { id: String(b._id), name: b.name }]));
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const chargeById = new Map(charges.map((c) => [String(c._id), c]));
  const copyById = new Map(copies.map((c) => [String(c._id), c]));
  const bookById = new Map(books.map((b) => [String(b._id), b]));
  const loanById = new Map(loans.map((l) => [String(l._id), l]));
  const person = (id) => (id ? { id: String(id), name: userName.get(String(id)) || 'Unknown' } : null);

  return docs.map((d) => {
    const c = campusById.get(String(d.campusId));
    const st = studentById.get(String(d.studentId));
    return {
      id: String(d._id),
      receiptNumber: d.receiptNumber,
      campus: c
        ? {
          id: c.id, name: c.name, code: c.code, libraryName: c.libraryName || '', receiptAddress: c.receiptAddress || '',
          receiptPhone: c.receiptPhone || '', openingHours: c.openingHours || '',
        }
        : null,
      student: {
        id: String(d.studentId), fullName: st?.fullName || '', regNumber: st?.regNumber || '',
        batch: st ? batchById.get(String(st.batchId)) || null : null,
      },
      amount: d.amount,
      note: d.note || '',
      receivedAt: d.receivedAt,
      receivedBy: person(d.receivedBy),
      allocations: (d.allocations || []).map((a) => {
        const ch = chargeById.get(String(a.chargeId));
        const copy = ch ? copyById.get(String(ch.copyId)) : null;
        const book = copy ? bookById.get(String(copy.bookId)) : null;
        const loan = ch && ch.type === 'LATE' ? loanById.get(String(ch.loanId)) : null;
        return {
          chargeId: String(a.chargeId),
          amount: a.amount,
          charge: {
            type: ch?.type || '', amount: ch?.amount ?? 0,
            catalogNumber: copy?.catalogNumber || '', title: book?.title || '',
            daysLate: loan ? (loan.fineDays ?? null) : null,
            waivedDays: loan ? (loan.fineWaivedDays ?? 0) : null,
            chargeableDays: loan && loan.fineDays !== null && loan.fineDays !== undefined
              ? Math.max(0, loan.fineDays - (loan.fineWaivedDays || 0)) : null,
          },
        };
      }),
      voided: d.voided ? { at: d.voided.at, by: person(d.voided.by), reason: d.voided.reason || '' } : null,
      createdAt: normalize(d).createdAt,
    };
  });
};

module.exports = { findById, shapeMany };
