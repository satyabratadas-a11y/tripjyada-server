const express = require('express');
const { requireClientRole } = require('../middleware/contentAccess');
const ctrl = require('../controllers/campaign.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(ctrl.listCampaigns));
router.post('/', requireClientRole('owner'), asyncHandler(ctrl.createCampaign));
router.patch('/:id', requireClientRole('owner'), asyncHandler(ctrl.updateCampaign));
router.delete('/:id', requireClientRole('owner'), asyncHandler(ctrl.deleteCampaign));

module.exports = router;
