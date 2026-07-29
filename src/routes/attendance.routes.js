const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/attendance.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth);

router.post('/checkin', asyncHandler(ctrl.checkIn));
router.get('/today', requireRole('admin'), asyncHandler(ctrl.listToday));

module.exports = router;
