'use strict';

const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/ticketController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// In-memory upload (serverless-friendly); 12 MB cap.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

router.get('/', requireAuth, ctrl.listTickets);
router.get('/version', requireAuth, ctrl.getVersion);
router.get('/stats', requireAuth, ctrl.getStats);
router.post('/upload', requireAuth, requireRole('itstaff', 'admin'), upload.single('file'), ctrl.uploadCsv);
router.patch('/:ticketId/root-cause', requireAuth, requireRole('itstaff', 'admin'), ctrl.setRootCause);
router.post('/:ticketId/notes', requireAuth, requireRole('itstaff', 'admin'), ctrl.addNote);
router.delete('/:ticketId/notes/:index', requireAuth, requireRole('itstaff', 'admin'), ctrl.deleteNote);
router.delete('/', requireAuth, requireRole('superadmin'), ctrl.wipeTickets);
router.delete('/:ticketId', requireAuth, requireRole('admin'), ctrl.deleteTicket);

module.exports = router;
