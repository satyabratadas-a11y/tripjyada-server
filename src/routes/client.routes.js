const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireClientAccess, requireClientRole } = require('../middleware/contentAccess');
const asyncHandler = require('../utils/asyncHandler');
const ctrl = require('../controllers/client.controller');
const commentCtrl = require('../controllers/contentEntry.controller');
const pillarRoutes = require('./pillar.routes');
const campaignRoutes = require('./campaign.routes');
const entryRoutes = require('./contentEntry.routes');
const aiRoutes = require('./ai.routes');

const router = express.Router();

router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listClients));
router.post('/', asyncHandler(ctrl.createClient));

router.use('/:clientId', asyncHandler(requireClientAccess));

router.get('/:clientId', asyncHandler(ctrl.getClient));
router.patch('/:clientId', requireClientRole('owner', 'editor', 'viewer'), asyncHandler(ctrl.updateClient));
router.delete('/:clientId', requireRole('admin'), asyncHandler(ctrl.deleteClient));
router.post('/:clientId/members', requireRole('admin'), asyncHandler(ctrl.addMember));
router.delete('/:clientId/members/:userId', requireRole('admin'), asyncHandler(ctrl.removeMember));
router.delete('/:clientId/comments/:commentId', asyncHandler(commentCtrl.deleteComment));

router.use('/:clientId/pillars', pillarRoutes);
router.use('/:clientId/campaigns', campaignRoutes);
router.use('/:clientId/entries', entryRoutes);
router.use('/:clientId/ai', aiRoutes);

module.exports = router;
