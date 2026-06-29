'use strict';

const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/ticketController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// In-memory upload (serverless-friendly); 12 MB cap.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

router.get('/', requireAuth, ctrl.listTickets);
router.get('/stats', requireAuth, ctrl.getStats);
router.post('/upload', requireAuth, requireRole('itstaff', 'admin'), upload.single('file'), ctrl.uploadCsv);
router.patch('/:ticketId/root-cause', requireAuth, requireRole('itstaff', 'admin'), ctrl.setRootCause);
router.delete('/', requireAuth, requireRole('superadmin'), ctrl.wipeTickets);

module.exports = router;
