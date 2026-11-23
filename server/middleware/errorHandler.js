const { logError } = require('../utils/audit');

// Mongo duplicate-key (E11000) — index field(s) → user-facing message
const UNIQUE_FIELD_MESSAGES = {
  regNumber:          'A student with this registration number already exists',
  email:              'This email address is already registered',
  name:               'A batch with this name already exists',
  code:               'A campus with this code already exists',
  campusId_catalogNumber: 'Catalog number already exists — please retry',
  campusId_receiptNumber: 'Receipt number clash — please retry',
  copyId: 'This copy is already issued',
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

  // Mongo duplicate-key error
  if (err.code === 11000 || err.code === 11001) {
    const pattern = err.keyPattern || err.keyValue || err.writeErrors?.[0]?.err?.keyPattern
      || err.writeErrors?.[0]?.err?.errInfo?.keyPattern || {};
    let field = Object.keys(pattern).join('_');
    // MongoBulkWriteError (insertMany) may carry no keyPattern — fall back to the message text.
    if (!field && /campusId_catalogNumber/.test(`${err.message || ''} ${err.writeErrors?.[0]?.err?.errmsg || ''}`)) {
      field = 'campusId_catalogNumber';
    }
    if (!field && /campusId_receiptNumber/.test(`${err.message || ''} ${err.writeErrors?.[0]?.err?.errmsg || ''}`)) {
      field = 'campusId_receiptNumber';
    }
    // 'name' is unique on both Batch and Campus — tell them apart by collection.
    if (field === 'name' && /\.Campus index/.test(err.message || '')) {
      return { status: 400, message: 'A campus with this name already exists' };
    }
    const message = UNIQUE_FIELD_MESSAGES[field] ?? 'This value is already in use';
    return { status: 400, message };
  }

  // Mongoose schema validation failure
  if (err.name === 'ValidationError') {
    const first = Object.values(err.errors || {})[0];
    return { status: 400, message: first?.message || 'Validation failed — please check your input' };
  }

  // Malformed ObjectId / uncastable value in a query
  if (err.name === 'CastError') {
    return { status: 400, message: 'Invalid identifier' };
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
