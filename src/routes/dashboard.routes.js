const express = require('express');
const requireAuth = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(ctrl.getDashboard));
router.get('/trend', requireAuth, asyncHandler(ctrl.getTrend));

module.exports = router;
