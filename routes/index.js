'use strict';

const express = require('express');
const multer = require('multer');
const ticketCtrl = require('../controllers/ticketController');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

// In-memory upload (serverless-friendly); 12 MB cap. Shared by the API-key import.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

router.use('/auth', require('./authRoutes'));
router.use('/tickets', require('./ticketRoutes'));
router.use('/snapshots', require('./snapshotRoutes'));
router.use('/users', require('./userRoutes'));
router.use('/settings', require('./settingRoutes'));
router.use('/audit', require('./auditRoutes'));
router.use('/presets', require('./presetRoutes'));

// Machine-to-machine CSV import. API key is checked BEFORE the file is parsed,
// so unauthenticated callers never get their upload read.
router.post('/upload-csv', requireApiKey, upload.single('file'), ticketCtrl.uploadCsvApiKey);

router.get('/health', (req, res) => res.json({ success: true, message: 'API healthy', data: { ts: new Date().toISOString() } }));

router.get('/seed-once', async (req, res) => {
  const token = req.headers['x-seed-token'];
  if (!token || token !== process.env.SEED_TOKEN) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { mongoose } = require('../config/db');
    const User = require('../models/User');
    const Setting = require('../models/Setting');
    await Setting.getGlobal();
    const username = 'admin';
    const password = process.env.SEED_ADMIN_PASS;
    if (!password) return res.status(500).json({ error: 'SEED_ADMIN_PASS not set' });
    const existing = await User.findOne({ username });
    if (existing) return res.json({ message: 'Admin user already exists' });
    const user = new User({ username, name: 'Super Admin', role: 'superadmin' });
    await user.setPassword(password);
    await user.save();
    res.json({ message: 'Superadmin created', username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/reset-admin', async (req, res) => {
  const token = req.headers['x-seed-token'];
  if (!token || token !== process.env.SEED_TOKEN) return res.status(403).json({ error: 'Forbidden' });
  try {
    const User = require('../models/User');
    const password = process.env.SEED_ADMIN_PASS;
    if (!password) return res.status(500).json({ error: 'SEED_ADMIN_PASS not set' });
    const user = await User.findOne({ username: 'admin' });
    if (!user) return res.status(404).json({ error: 'Admin user not found' });
    await user.setPassword(password);
    // Also clear any brute-force lock so the admin can log in immediately.
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();
    res.json({ message: 'Admin password reset and account unlocked' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
