'use strict';

const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { signToken } = require('../middleware/auth');
const {
  ok, created, fail, asyncHandler,
} = require('../utils/apiResponse');

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 minutes

async function audit(type, message, req, actor) {
  try {
    await AuditLog.create({
      type,
      message,
      actor: actor || 'anonymous',
      ip: req.ip || req.headers['x-forwarded-for'] || '',
    });
  } catch (_) { /* never let auditing break the request */ }
}

/**
 * POST /api/auth/register
 * First account ever created becomes superadmin; afterwards new self-registered
 * accounts default to 'viewer'. Admins create privileged users via /api/users.
 */
const register = asyncHandler(async (req, res) => {
  const { username, password, name, email } = req.body;

  const exists = await User.findOne({ username: username.toLowerCase() });
  if (exists) return fail(res, 'Username already taken', 409);

  const userCount = await User.estimatedDocumentCount();
  const role = userCount === 0 ? 'superadmin' : 'viewer';

  const user = new User({ username, name: name || '', email: email || '', role });
  await user.setPassword(password);
  await user.save();

  await audit('auth', `New account registered: ${user.username} (${role})`, req, user.username);

  const token = signToken(user);
  return created(res, { token, user: user.toJSON() }, 'Registration successful');
});

/**
 * POST /api/auth/login
 * Persisted lockout: after MAX_FAILED failures the account is locked for
 * LOCK_MS. Lock state lives in MongoDB so it can't be bypassed by refreshing
 * or switching devices.
 */
const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username: (username || '').toLowerCase() })
    .select('+passwordHash +failedLoginAttempts +lockUntil');

  // Uniform failure message to avoid username enumeration.
  const invalid = () => fail(res, 'Invalid username or password', 401);

  if (!user) {
    await audit('login', `Failed login (no such user): ${username}`, req);
    return invalid();
  }

  if (user.isLocked) {
    await audit('login', `Login blocked (account locked): ${user.username}`, req, user.username);
    return fail(res, 'Account temporarily locked due to repeated failed attempts. Try again later.', 423);
  }

  if (!user.active) return fail(res, 'Account is disabled', 403);

  const match = await user.verifyPassword(password);
  if (!match) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= MAX_FAILED) {
      user.lockUntil = new Date(Date.now() + LOCK_MS);
      user.failedLoginAttempts = 0;
      await audit('login', `Account locked after ${MAX_FAILED} failures: ${user.username}`, req, user.username);
    } else {
      await audit('login', `Failed login attempt (${user.failedLoginAttempts}/${MAX_FAILED}): ${user.username}`, req, user.username);
    }
    await user.save();
    return invalid();
  }

  // Success - reset counters
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  await audit('login', `Successful login: ${user.username}`, req, user.username);

  const token = signToken(user);
  return ok(res, { token, user: user.toJSON() }, 'Login successful');
});

/** GET /api/auth/me - current user from token. */
const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return fail(res, 'User not found', 404);
  return ok(res, { user: user.toJSON() });
});

/** POST /api/auth/change-password */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) return fail(res, 'User not found', 404);

  const match = await user.verifyPassword(currentPassword);
  if (!match) return fail(res, 'Current password is incorrect', 401);

  await user.setPassword(newPassword);
  await user.save();
  await audit('auth', `Password changed: ${user.username}`, req, user.username);
  return ok(res, null, 'Password updated');
});

module.exports = { register, login, me, changePassword };
