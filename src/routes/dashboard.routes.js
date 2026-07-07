const express = require('express');
const requireAuth = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(ctrl.getDashboard));

module.exports = router;
