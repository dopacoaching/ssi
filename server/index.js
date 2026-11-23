const path = require('path');
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const { connectDB } = require('./utils/db');
const { verifyToken } = require('./middleware/auth');
const { blockLibrarian, requireLibraryAccess } = require('./middleware/libraryScope');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// Vercel (and most PaaS) put the app behind exactly one proxy. Without this,
// `req.ip` is the proxy's address for every request, so express-rate-limit
// buckets all clients together — one shared login/refresh quota for everyone.
app.set('trust proxy', 1);

const allowedOrigin = process.env.CLIENT_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:5173' : null);
if (!allowedOrigin) {
  console.error('[startup] CLIENT_URL environment variable is not set — cannot start in production');
  throw new Error('CLIENT_URL must be set in production');
}

app.use(helmet());
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(cookieParser());
// Bulk catalog import carries up to 1000 rows and needs a larger body limit, so the default
// 100kb parser skips that path; its 4mb parser is mounted below, after the DB connection, so
// the caller's library access is verified BEFORE the large body is read.
const BULK_PATH = '/api/library/books/bulk';
const defaultJson = express.json({ limit: '100kb' });
app.use((req, res, next) => (req.path.startsWith(BULK_PATH) ? next() : defaultJson(req, res, next)));

// Ensure the MongoDB connection is established (and reused) before any route
// touches the database. On Vercel this runs per cold start; the connection is
// cached on `global` thereafter.
app.use((req, res, next) => {
  connectDB().then(() => next()).catch(next);
});

// 4mb stays under Vercel's 4.5MB cap.
app.use(BULK_PATH, verifyToken, requireLibraryAccess, express.json({ limit: '4mb' }));

// API Routes
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/library', require('./routes/library'));
// Library staff may only use /api/auth and /api/library — everything below is off limits.
app.use('/api',        blockLibrarian);
app.use('/api',        require('./routes/students'));
app.use('/api',        require('./routes/ce'));
app.use('/api',        require('./routes/tests'));
app.use('/api',        require('./routes/remarks'));
app.use('/api/admin',  require('./routes/admin'));

// Serve static files only when running as a monolith (not on Vercel)
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../client', 'dist', 'index.html'));
  });
}

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
}

module.exports = app;
