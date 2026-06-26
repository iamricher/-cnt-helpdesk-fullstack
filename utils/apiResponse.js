'use strict';

/**
 * Standardised JSON envelope so every endpoint returns a predictable shape:
 *   { success: boolean, data?: any, message?: string, errors?: any[], meta?: object }
 */

function ok(res, data = null, message = 'OK', status = 200, meta = undefined) {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

function created(res, data = null, message = 'Created') {
  return ok(res, data, message, 201);
}

function fail(res, message = 'Error', status = 400, errors = undefined) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
}

/**
 * Wraps an async route handler so thrown errors / rejected promises are
 * forwarded to the centralised error middleware instead of crashing.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

class ApiError extends Error {
  constructor(message, status = 400, errors = undefined) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.isApiError = true;
  }
}

module.exports = {
  ok, created, fail, asyncHandler, ApiError,
};
