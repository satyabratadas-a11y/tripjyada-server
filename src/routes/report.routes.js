const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/report.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/monthly', asyncHandler(ctrl.getMonthlyReportJSON));
router.get('/monthly/download', asyncHandler(ctrl.downloadMonthlyReport));
router.get('/monthly/download-pdf', asyncHandler(ctrl.downloadMonthlyReportPDF));

module.exports = router;
