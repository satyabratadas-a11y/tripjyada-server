const express = require('express');
const { requireClientRole } = require('../middleware/contentAccess');
const ctrl = require('../controllers/campaign.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(ctrl.listCampaigns));
router.post('/', requireClientRole('owner', 'editor', 'viewer'), asyncHandler(ctrl.createCampaign));
router.patch('/:id', requireClientRole('owner', 'editor', 'viewer'), asyncHandler(ctrl.updateCampaign));
router.delete('/:id', requireClientRole('owner', 'editor', 'viewer'), asyncHandler(ctrl.deleteCampaign));

module.exports = router;
