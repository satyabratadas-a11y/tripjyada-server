const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/admin.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/users', asyncHandler(ctrl.listUsers));
router.get('/audit-logs', asyncHandler(ctrl.listAuditLogs));
router.patch('/users/:id/approve', asyncHandler(ctrl.approveUser));
router.patch('/users/:id', asyncHandler(ctrl.updateUser));

module.exports = router;
