'use strict';

const { fail } = require('../utils/apiResponse');

/** 404 for unmatched API routes. */
function notFound(req, res) {
  return fail(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

/**
 * Centralised error handler. Normalises Mongoose, JWT and validation errors
 * into the standard JSON envelope and never leaks stack traces in production.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Our own typed errors
  if (err && err.isApiError) {
    return fail(res, err.message, err.status || 400, err.errors);
  }
  // Mongoose validation
  if (err && err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return fail(res, 'Validation failed', 422, errors);
  }
  // Mongoose duplicate key
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return fail(res, `Duplicate value for ${field}`, 409);
  }
  // Mongoose cast (bad ObjectId etc.)
  if (err && err.name === 'CastError') {
    return fail(res, `Invalid ${err.path}`, 400);
  }

  // eslint-disable-next-line no-console
  console.error('[error]', err);
  const msg = process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error');
  return fail(res, msg, err.status || 500);
}

module.exports = { notFound, errorHandler };
