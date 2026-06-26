'use strict';

const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post(
  '/register',
  authLimiter,
  [
    body('username').isString().trim().isLength({ min: 3, max: 50 }).withMessage('Username 3-50 chars'),
    body('password').isString().isLength({ min: 12 }).withMessage('Password must be at least 12 characters'),
    body('name').optional().isString().trim().isLength({ max: 120 }),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email'),
  ],
  validate,
  ctrl.register,
);

router.post(
  '/login',
  authLimiter,
  [
    body('username').isString().trim().notEmpty().withMessage('Username required'),
    body('password').isString().notEmpty().withMessage('Password required'),
  ],
  validate,
  ctrl.login,
);

router.get('/me', requireAuth, ctrl.me);

router.post(
  '/change-password',
  requireAuth,
  [
    body('currentPassword').isString().notEmpty(),
    body('newPassword').isString().isLength({ min: 12 }).withMessage('New password must be at least 12 characters'),
  ],
  validate,
  ctrl.changePassword,
);

module.exports = router;
