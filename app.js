'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');

const config = require('./config');
const { connectDB } = require('./config/db');
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiters');

const app = express();

// Behind Vercel's proxy - trust it so req.ip / rate-limit keys are correct.
app.set('trust proxy', 1);

// Security headers. CSP is permissive enough for the existing inline dashboard
// (which uses inline scripts/styles and CDN libraries) while still adding the
// other helmet protections.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());

// CORS: explicit allowlist in prod, reflect origin in dev.
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin / curl
    if (!config.cors.origins.length) return cb(null, true); // dev convenience
    if (config.cors.origins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Strip any keys containing `$` or `.` to defeat NoSQL operator injection.
app.use(mongoSanitize());

// Ensure DB is connected before any /api request is handled (serverless-safe).
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[db] connection failed', e.message);
    res.status(503).json({ success: false, message: 'Database unavailable' });
  }
});

app.use('/api', apiLimiter, apiRoutes);

// Serve the static front-end (the dashboard) from /public.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', extensions: ['html'] }));

// SPA-style fallback: any non-API GET returns the dashboard shell.
app.get(/^(?!\/api).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  return res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => { if (err) next(); });
});

// 404 for unmatched API + central error handler
app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
