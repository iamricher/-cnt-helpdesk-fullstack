'use strict';

const express = require('express');
const ctrl = require('../controllers/presetController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Presets are shared filter shortcuts available to any authenticated user.
router.get('/', requireAuth, ctrl.listPresets);
router.post('/', requireAuth, ctrl.createPreset);
router.delete('/:id', requireAuth, ctrl.deletePreset);

module.exports = router;
