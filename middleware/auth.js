'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { fail, asyncHandler } = require('../utils/apiResponse');

/** Sign a JWT for a user document. */
function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, username: user.username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

/**
 * Require a valid Bearer token. Attaches req.user (lean) when valid.
 * Verifies the user still exists and is active on every request - a disabled
 * account is rejected even with an otherwise-valid token.
 */
const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 'Authentication required', 401);

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (e) {
    return fail(res, 'Invalid or expired token', 401);
  }

  const user = await User.findById(payload.sub).lean();
  if (!user || !user.active) return fail(res, 'Account not found or disabled', 401);

  req.user = { id: user._id.toString(), role: user.role, username: user.username, name: user.name };
  return next();
});

/**
 * Restrict a route to specific roles. Usage: requireRole('admin', 'superadmin').
 * superadmin implicitly passes any role check.
 */
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 'Authentication required', 401);
    if (req.user.role === 'superadmin') return next();
    if (!allowed.includes(req.user.role)) {
      return fail(res, 'You do not have permission to perform this action', 403);
    }
    return next();
  };
}

module.exports = { signToken, requireAuth, requireRole };
