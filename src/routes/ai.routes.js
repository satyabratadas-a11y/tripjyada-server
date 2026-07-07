const express = require('express');
const { requireClientRole } = require('../middleware/contentAccess');
const ctrl = require('../controllers/ai.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/ideas', requireClientRole('owner', 'editor'), asyncHandler(ctrl.generateIdeas));
router.post('/caption', requireClientRole('owner', 'editor'), asyncHandler(ctrl.generateCaption));
router.post('/hook', requireClientRole('owner', 'editor'), asyncHandler(ctrl.generateHook));
router.post('/calendar', requireClientRole('owner', 'editor'), asyncHandler(ctrl.generateCalendar));

module.exports = router;
