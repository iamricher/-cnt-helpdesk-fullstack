'use strict';

const { connectDB, mongoose } = require('../config/db');
const User = require('../models/User');
const Setting = require('../models/Setting');

module.exports = async (req, res) => {
  const token = req.headers['x-seed-token'];
  if (!token || token !== process.env.SEED_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    await connectDB();
    await Setting.getGlobal();

    const username = 'admin';
    const password = process.env.SEED_ADMIN_PASS;

    if (!password) return res.status(500).json({ error: 'SEED_ADMIN_PASS not set' });

    const existing = await User.findOne({ username });
    if (existing) {
      await mongoose.connection.close();
      return res.json({ message: 'Admin user already exists' });
    }

    const user = new User({ username, name: 'Super Admin', role: 'superadmin' });
    await user.setPassword(password);
    await user.save();
    await mongoose.connection.close();

    res.json({ message: 'Superadmin created successfully', username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
