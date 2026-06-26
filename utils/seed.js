'use strict';

/**
 * Seed script. Creates the initial superadmin account and the global settings
 * singleton. Run once after configuring MONGODB_URI:
 *   SEED_ADMIN_USER=admin SEED_ADMIN_PASS='YourStrongPass123!' npm run seed
 */
require('dotenv').config();
const { connectDB, mongoose } = require('../config/db');
const User = require('../models/User');
const Setting = require('../models/Setting');

async function run() {
  await connectDB();

  const username = (process.env.SEED_ADMIN_USER || 'admin').toLowerCase();
  const password = process.env.SEED_ADMIN_PASS || '';

  if (!password || password.length < 12) {
    // eslint-disable-next-line no-console
    console.error('Set SEED_ADMIN_PASS to a password of at least 12 characters.');
    process.exit(1);
  }

  await Setting.getGlobal();
  // eslint-disable-next-line no-console
  console.log('[seed] global settings ensured');

  const existing = await User.findOne({ username });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`[seed] user "${username}" already exists - skipping`);
  } else {
    const user = new User({ username, name: 'Super Admin', role: 'superadmin' });
    await user.setPassword(password);
    await user.save();
    // eslint-disable-next-line no-console
    console.log(`[seed] created superadmin "${username}"`);
  }

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed', e);
  process.exit(1);
});
