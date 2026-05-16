const { logError } = require('../utils/audit');

// Prisma P2002 unique constraint — field key → user-facing message
const UNIQUE_FIELD_MESSAGES = {
  regNumber:          'A student with this registration number already exists',
  email:              'This email address is already registered',
  name:               'A batch with this name already exists',
  batchId_month_year: 'An approval record for this batch and period already exists',
};

const MULTER_CODE_MESSAGES = {
  LIMIT_FILE_SIZE:       'File is too large — maximum size is 5 MB',
  LIMIT_UNEXPECTED_FILE: 'Unexpected file field in upload',
  LIMIT_FILE_COUNT:      'Too many files uploaded at once',
};

function classifyError(err) {
  // Multer errors (field limits, file size, etc.)
  if (err.name === 'MulterError') {
    return { status: 400, message: MULTER_CODE_MESSAGES[err.code] || 'File upload error' };
  }

  // Prisma errors — code always starts with 'P'
  if (typeof err.code === 'string' && err.code.startsWith('P')) {
    if (err.code === 'P2002') {
      const target = err.meta?.target ?? '';
      let field;
      if (Array.isArray(target)) {
        // PostgreSQL / MySQL: array of field names
        field = target.join('_');
      } else {
        // MongoDB: index name like "Student_regNumber_key"
        const m = String(target).match(/^[^_]+_(.+?)_key$/);
        field = m ? m[1] : String(target);
      }
      const message = UNIQUE_FIELD_MESSAGES[field] ?? 'This value is already in use';
      return { status: 400, message };
    }
    if (err.code === 'P2025') {
      return { status: 404, message: 'Record not found' };
    }
    if (err.code === 'P2003') {
      return { status: 400, message: 'The referenced record does not exist' };
    }
    // Catch-all for other Prisma errors
    return { status: 400, message: 'Database operation failed — please check your input' };
  }

  return null;
}

function errorHandler(err, req, res, next) {
  console.error(err);

  const classified = classifyError(err);
  if (classified) {
    return res.status(classified.status).json({ success: false, message: classified.message });
  }

  const status = err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';
  const message = isProduction && status === 500
    ? 'Internal server error'
    : err.message || 'Internal server error';

  if (status >= 500) {
    logError(req, status, err.message || 'Unknown server error');
  }

  res.status(status).json({ success: false, message });
}

module.exports = { errorHandler };
