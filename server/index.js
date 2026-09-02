const path = require('path');
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const { connectDB } = require('./utils/db');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

const allowedOrigin = process.env.CLIENT_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:5173' : null);
if (!allowedOrigin) {
  console.error('[startup] CLIENT_URL environment variable is not set — cannot start in production');
  throw new Error('CLIENT_URL must be set in production');
}

app.use(helmet());
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Ensure the MongoDB connection is established (and reused) before any route
// touches the database. On Vercel this runs per cold start; the connection is
// cached on `global` thereafter.
app.use((req, res, next) => {
  connectDB().then(() => next()).catch(next);
});

// API Routes
app.use('/api/auth',   require('./routes/auth'));
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
