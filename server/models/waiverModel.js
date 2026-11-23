const { Waiver, Charge, Student, User, normalize } = require('./schemas');
const campusModel = require('./campusModel');
const chargeModel = require('./chargeModel');

const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];

const findById = (id, { session } = {}) => Waiver.findById(id).session(session || null).lean();

const findByStudent = (studentId, scope = {}, limit = 500) =>
  Waiver.find({ studentId, ...scope }).sort({ requestedAt: -1, _id: -1 }).limit(limit).lean();

// WaiverView[] (campus / student / charge(ChargeView) / users stitched in batched queries).
const shapeMany = async (docs) => {
  if (docs.length === 0) return [];
  const [campuses, students, users, chargeDocs] = await Promise.all([
    campusModel.summariesByIds(docs.map((d) => d.campusId)),
    Student.find({ _id: { $in: uniq(docs.map((d) => d.studentId)) } }).select('fullName regNumber').lean(),
    User.find({ _id: { $in: uniq(docs.flatMap((d) => [d.requestedBy, d.decidedBy])) } }).select('name').lean(),
    Charge.find({ _id: { $in: uniq(docs.map((d) => d.chargeId)) } }).lean(),
  ]);
  const chargeViews = await chargeModel.shapeMany(chargeDocs);
  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const chargeById = new Map(chargeViews.map((c) => [c.id, c]));
  const person = (id) => (id ? { id: String(id), name: userName.get(String(id)) || 'Unknown' } : null);
  return docs.map((d) => {
    const n = normalize(d);
    const st = studentById.get(String(d.studentId));
    return {
      id: n.id, type: n.type, status: n.status, amount: n.amount, approvedAmount: n.approvedAmount ?? null,
      reason: n.reason || '', decisionNote: n.decisionNote || '',
      campus: campuses.get(String(d.campusId)) || null,
      student: { id: n.studentId, fullName: st?.fullName || '', regNumber: st?.regNumber || '' },
      charge: chargeById.get(String(d.chargeId)) || null,
      requestedBy: person(d.requestedBy), requestedAt: n.requestedAt,
      decidedBy: person(d.decidedBy), decidedAt: n.decidedAt || null,
      finePeriodId: n.finePeriodId || null,
    };
  });
};

module.exports = { findById, findByStudent, shapeMany };
