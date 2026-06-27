'use strict';

const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/userController');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', ctrl.listUsers);

router.post(
  '/',
  [
    body('username').isString().trim().isLength({ min: 3, max: 50 }),
    body('password').isString().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['viewer', 'itstaff', 'admin', 'superadmin']),
    body('email').optional({ checkFalsy: true }).isEmail(),
  ],
  validate,
  ctrl.createUser,
);

router.patch(
  '/:id',
  [
    body('role').optional().isIn(['viewer', 'itstaff', 'admin', 'superadmin']),
    body('active').optional().isBoolean(),
    body('email').optional({ checkFalsy: true }).isEmail(),
  ],
  validate,
  ctrl.updateUser,
);

router.post(
  '/:id/reset-password',
  [body('newPassword').isString().isLength({ min: 6 }).withMessage('Password must be at least 6 characters')],
  validate,
  ctrl.resetPassword,
);

router.delete('/:id', ctrl.deleteUser);

module.exports = router;
