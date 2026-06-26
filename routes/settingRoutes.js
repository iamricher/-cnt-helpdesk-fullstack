'use strict';

const express = require('express');
const ctrl = require('../controllers/settingController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.get('/', requireAuth, ctrl.getSettings);
router.put('/', requireAuth, requireRole('admin'), ctrl.updateSettings);
module.exports = router;
