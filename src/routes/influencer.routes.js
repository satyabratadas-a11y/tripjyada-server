const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/influencer.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listInfluencers));
router.post('/', requireRole('admin'), asyncHandler(ctrl.createInfluencer));
router.patch('/:id', requireRole('admin'), asyncHandler(ctrl.updateInfluencer));
router.delete('/:id', requireRole('admin'), asyncHandler(ctrl.deleteInfluencer));

module.exports = router;
