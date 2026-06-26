'use strict';

const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { ok, created, fail, asyncHandler } = require('../utils/apiResponse');

/** GET /api/users - list all (admin+). */
const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find({}).sort({ createdAt: -1 }).lean();
  return ok(res, users.map((u) => { delete u.passwordHash; delete u.failedLoginAttempts; delete u.lockUntil; return u; }));
});

/** POST /api/users - create a user with an explicit role (admin+). */
const createUser = asyncHandler(async (req, res) => {
  const { username, password, name, email, role } = req.body;
  const exists = await User.findOne({ username: username.toLowerCase() });
  if (exists) return fail(res, 'Username already taken', 409);

  // Only superadmin may mint another superadmin.
  let finalRole = role || 'viewer';
  if (finalRole === 'superadmin' && req.user.role !== 'superadmin') finalRole = 'admin';

  const user = new User({ username, name: name || '', email: email || '', role: finalRole });
  await user.setPassword(password);
  await user.save();
  await AuditLog.create({ type: 'user', message: `User created: ${user.username} (${finalRole})`, actor: req.user.username, ip: req.ip || '' });
  return created(res, user.toJSON(), 'User created');
});

/** PATCH /api/users/:id - update role / active / name / email (admin+). */
const updateUser = asyncHandler(async (req, res) => {
  const { role, active, name, email } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return fail(res, 'User not found', 404);

  // Guard: don't let a non-superadmin elevate someone to superadmin or edit one.
  if ((user.role === 'superadmin' || role === 'superadmin') && req.user.role !== 'superadmin') {
    return fail(res, 'Only a super admin can modify super admin accounts', 403);
  }
  if (role) user.role = role;
  if (typeof active === 'boolean') user.active = active;
  if (typeof name === 'string') user.name = name;
  if (typeof email === 'string') user.email = email;
  await user.save();
  await AuditLog.create({ type: 'user', message: `User updated: ${user.username}`, actor: req.user.username, ip: req.ip || '' });
  return ok(res, user.toJSON(), 'User updated');
});

/** POST /api/users/:id/reset-password - admin sets a new password (admin+). */
const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  const user = await User.findById(req.params.id).select('+passwordHash');
  if (!user) return fail(res, 'User not found', 404);
  if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
    return fail(res, 'Only a super admin can reset a super admin password', 403);
  }
  await user.setPassword(newPassword);
  user.failedLoginAttempts = 0; user.lockUntil = null;
  await user.save();
  await AuditLog.create({ type: 'user', message: `Password reset for: ${user.username}`, actor: req.user.username, ip: req.ip || '' });
  return ok(res, null, 'Password reset');
});

/** DELETE /api/users/:id (admin+). */
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return fail(res, 'User not found', 404);
  if (user.role === 'superadmin') return fail(res, 'Super admin accounts cannot be deleted', 403);
  if (user._id.toString() === req.user.id) return fail(res, 'You cannot delete your own account', 400);
  await user.deleteOne();
  await AuditLog.create({ type: 'user', message: `User deleted: ${user.username}`, actor: req.user.username, ip: req.ip || '' });
  return ok(res, null, 'User deleted');
});

module.exports = { listUsers, createUser, updateUser, resetPassword, deleteUser };
