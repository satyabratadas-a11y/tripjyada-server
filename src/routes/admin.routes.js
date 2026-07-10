const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/admin.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/users', requireRole('super_admin'), asyncHandler(ctrl.listUsers));
router.get('/audit-logs', asyncHandler(ctrl.listAuditLogs));
router.patch('/users/:id/approve', requireRole('super_admin'), asyncHandler(ctrl.approveUser));
router.patch('/users/:id', requireRole('super_admin'), asyncHandler(ctrl.updateUser));

module.exports = router;
