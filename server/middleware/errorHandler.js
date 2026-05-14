function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';
  const message = isProduction && status === 500
    ? 'Internal server error'
    : err.message || 'Internal server error';
  res.status(status).json({ success: false, message });
}

module.exports = { errorHandler };
