'use strict';

const express = require('express');
const ctrl = require('../controllers/ticketController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.get('/', requireAuth, ctrl.listSnapshots);
module.exports = router;
