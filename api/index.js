'use strict';

/**
 * Vercel serverless entry point. Vercel routes all traffic here (see vercel.json).
 * The Express app handles both /api/* and the static dashboard.
 */
require('dotenv').config();
const app = require('../app');

module.exports = app;
