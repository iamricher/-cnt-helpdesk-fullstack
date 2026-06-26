'use strict';

/**
 * Centralised configuration. Everything sensitive comes from environment
 * variables; sane non-sensitive defaults are provided inline.
 */

module.exports = {
  env: process.env.NODE_ENV || 'development',
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-env-this-is-not-secure',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  bcrypt: {
    // Cost factor. 12 is a good production default (OWASP-aligned).
    rounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  },
  cors: {
    // Comma-separated list of allowed origins, e.g.
    // "https://my-app.vercel.app,https://helpdesk.cnt.com"
    // Empty / unset => reflect request origin (dev convenience only).
    origins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  rateLimit: {
    authWindowMs: 15 * 60 * 1000, // 15 minutes
    authMax: 10, // login/register attempts per window per IP
    apiWindowMs: 60 * 1000,
    apiMax: 200,
  },
  // SLA business defaults (seconds). Mirrors the original client engine exactly.
  sla: {
    tiers: {
      high: { fr: 1800, ct: 28800 }, // 30 min FR / 8 hr CT
      medium: { fr: 3600, ct: 86400 }, // 1 hr FR / 24 hr CT
      low: { fr: 14400, ct: 259200 }, // 4 hr FR / 72 hr CT
    },
    defaultTier: 'medium',
  },
  staleThresholds: { high: 1, medium: 3, low: 7 }, // days
};
