// Library Phase 5: No-Dues check + slip, and the student library-dues endpoint used by the
// deactivation warning (mounted under /api/students).
const { mongoose } = require('../utils/db');
const campusModel = require('../models/campusModel');
const { Student } = require('../models/schemas');
const svc = require('../services/circulationService');
const clearance = require('../services/clearanceService');
const fine = require('../services/fineService');
const { logAudit } = require('../utils/audit');
const { ok, badRequest, forbidden, notFound } = require('../views/response');
const { cleanReg } = require('./circulationController');

const ObjectId = mongoose.Types.ObjectId;

// Shared by check + slip. Returns { found, dues, summary, ledger, campus } or sends the response.
async function evaluate(req, res) {
  const reg = cleanReg(req.params.regNumber);
  if (reg.error) { badRequest(res, reg.error); return null; }
  const found = await svc.findStudentByReg(reg.value);
  if (!found) { notFound(res, 'No student with this Reg Number'); return null; }
  const now = new Date();
  const ledger = await svc.loadLedger(found.student._id);
  const dues = await clearance.duesFor(found.student._id, { now, ledger });
  const campus = req.library.isAdmin ? null : await campusModel.findById(req.library.campusId);
  return { found, dues, ledger, campus, now };
}

async function check(req, res) {
  const ev = await evaluate(req, res);
  if (!ev) return;
  const { found, dues, ledger, campus, now } = ev;
  const own = req.library.isAdmin ? null : String(req.library.campusId);
  const mine = (x) => !own || (x.campus && x.campus.id === own);

  let otherCampuses = null;
  if (!req.library.isAdmin) {
    const summary = svc.summarizeLedger(ledger, now);
    otherCampuses = svc.otherCampusSummary(summary, own, await svc.codesFor(summary, own));
  }
  const studentCampuses = await campusModel.summariesByIds(found.campusId ? [found.campusId] : []);
  return ok(res, {
    student: svc.shapeStudent(found.student, found.batch, studentCampuses.get(found.campusId) || null),
    isClear: dues.isClear,
    outstanding: dues.outstanding,
    thisCampus: { openLoans: dues.openLoans.filter(mine), charges: dues.charges.filter(mine) },
    otherCampuses,
    checkedAt: now,
    checkedBy: { id: String(req.user.id), name: req.user.name || '' },
    campus: campus ? { id: campus.id, name: campus.name, code: campus.code, libraryName: campus.libraryName || '' } : null,
  });
}

async function slip(req, res) {
  const ev = await evaluate(req, res);
  if (!ev) return;
  const { found, dues, campus, now } = ev;
  if (!dues.isClear) return badRequest(res, 'Student has pending library dues');

  const ymd = fine.istDate(now).replace(/-/g, '');
  const reference = `${campus ? campus.code : 'ALL'}-ND-${ymd}-${new ObjectId().toHexString().slice(-6).toUpperCase()}`;
  const studentCampuses = await campusModel.summariesByIds(found.campusId ? [found.campusId] : []);
  await logAudit(req, 'CREATE', 'Student', String(found.student._id),
    `Printed No-Dues slip for ${found.student.regNumber} (${found.student.fullName}) — reference ${reference}`);
  return ok(res, {
    reference,
    issuedAt: now,
    issuedBy: { id: String(req.user.id), name: req.user.name || '' },
    student: svc.shapeStudent(found.student, found.batch, studentCampuses.get(found.campusId) || null),
    campus: campus
      ? { id: campus.id, name: campus.name, code: campus.code, libraryName: campus.libraryName || '',
          receiptAddress: campus.receiptAddress || '', receiptPhone: campus.receiptPhone || '' }
      : null,
  });
}

// GET /api/students/:id/library-dues (ADMIN / TEACHER of the student's batch).
async function studentDues(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return notFound(res, 'Student not found');
  const student = await Student.findById(id).select('batchId').lean();
  if (!student) return notFound(res, 'Student not found');
  if (req.user.role === 'TEACHER' && !(req.user.batchIds || []).includes(String(student.batchId))) {
    return forbidden(res);
  }
  return ok(res, await clearance.duesFor(student._id));
}

module.exports = { check, slip, studentDues };
