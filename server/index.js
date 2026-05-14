const path = require('path');
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

const allowedOrigin = process.env.CLIENT_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:5173' : null);
if (!allowedOrigin) throw new Error('CLIENT_URL must be set in production');

app.use(helmet());
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

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
