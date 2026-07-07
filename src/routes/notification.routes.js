const express = require('express');
const requireAuth = require('../middleware/auth');
const ctrl = require('../controllers/notification.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listNotifications));
router.patch('/read-all', asyncHandler(ctrl.markAllRead));
router.patch('/:id/read', asyncHandler(ctrl.markRead));

module.exports = router;
