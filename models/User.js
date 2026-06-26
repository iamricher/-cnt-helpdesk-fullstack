'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');

const { Schema } = mongoose;

const ROLES = ['viewer', 'itstaff', 'admin', 'superadmin'];

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [50, 'Username too long'],
      index: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: [120, 'Name too long'],
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      match: [/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email'],
    },
    // Never selected by default - must be explicitly requested with .select('+passwordHash')
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ROLES,
      default: 'viewer',
      index: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    // Brute-force protection (persisted, survives across requests/devices)
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Virtual: is the account currently locked?
userSchema.virtual('isLocked').get(function isLocked() {
  return !!(this.lockUntil && this.lockUntil.getTime() > Date.now());
});

/** Set (and hash) a plaintext password. */
userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, config.bcrypt.rounds);
};

/** Compare a plaintext candidate against the stored hash. */
userSchema.methods.verifyPassword = async function verifyPassword(plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

/** Strip sensitive fields when serialising to JSON. */
userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.failedLoginAttempts;
    delete ret.lockUntil;
    delete ret.__v;
    return ret;
  },
});

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
