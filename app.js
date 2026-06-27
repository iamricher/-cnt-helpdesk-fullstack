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
      // Allow inline event handlers (onclick="...") used throughout the dashboard.
      // helmet's default sets script-src-attr to 'none', which blocks them.
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      // The PDF "Print Preview" renders a generated PDF as a blob: URL inside an
      // <iframe>; frame-src must allow blob: or Chrome shows "content is blocked".
      'frame-src': ["'self'", 'blob:'],
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
    // Disallowed origin: deny WITHOUT throwing. The CORS headers are simply not
    // set, so the browser blocks the cross-origin read; the request itself still
    // gets a normal response instead of a 500.
    return cb(null, false);
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
// HTML and JS are served with no-cache so client logic updates take effect on
// the next load; other assets (images, fonts) keep a short cache.
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(html|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

// SPA-style fallback: any non-API GET returns the dashboard shell.
app.get(/^(?!\/api).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  return res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => { if (err) next(); });
});

// 404 for unmatched API + central error handler
app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
