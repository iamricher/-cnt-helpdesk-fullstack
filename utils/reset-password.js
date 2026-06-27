'use strict';

require('dotenv').config({ path: '.env.local' });
const { connectDB, mongoose } = require('../config/db');
const User = require('../models/User');

async function run() {
  await connectDB();

  const username = process.env.RESET_USER || 'admin';
  const newPassword = process.env.RESET_PASS;

  if (!newPassword || newPassword.length < 12) {
    console.error('Set RESET_PASS to a password of at least 12 characters.');
    process.exit(1);
  }

  const user = await User.findOne({ username }).select('+passwordHash');
  if (!user) {
    console.error(`User "${username}" not found.`);
    process.exit(1);
  }

  await user.setPassword(newPassword);
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  console.log(`Password reset for "${username}" (role: ${user.role})`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((e) => {
  console.error('Reset failed:', e.message);
  process.exit(1);
});
