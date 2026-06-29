'use strict';

const express = require('express');
const ctrl = require('../controllers/auditController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.get('/', requireAuth, requireRole('superadmin'), ctrl.listAudit);
router.delete('/', requireAuth, requireRole('superadmin'), ctrl.clearAudit);
module.exports = router;
