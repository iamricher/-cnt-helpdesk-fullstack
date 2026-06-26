'use strict';

const { validationResult } = require('express-validator');
const { fail } = require('../utils/apiResponse');

/**
 * Runs after express-validator chains; returns 422 with the collected errors
 * if any validation failed, otherwise passes through.
 */
function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array().map((e) => ({ field: e.path, message: e.msg }));
    return fail(res, 'Validation failed', 422, errors);
  }
  return next();
}

module.exports = { validate };
