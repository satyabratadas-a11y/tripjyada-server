const express = require('express');
const { requireClientRole } = require('../middleware/contentAccess');
const ctrl = require('../controllers/ai.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/ideas', requireClientRole('owner', 'editor', 'viewer'), asyncHandler(ctrl.generateIdeas));
router.post('/caption', requireClientRole('owner', 'editor', 'viewer'), asyncHandler(ctrl.generateCaption));
router.post('/hook', requireClientRole('owner', 'editor', 'viewer'), asyncHandler(ctrl.generateHook));

module.exports = router;
