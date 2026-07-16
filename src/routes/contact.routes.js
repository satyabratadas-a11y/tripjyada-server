const express = require('express');
const multer = require('multer');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/contact.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
// Saved photos are stored as base64 directly on the Contact document (no third-party host), so
// this cap keeps the base64-inflated size (~1.33x) comfortably under MongoDB's 16MB document limit.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });
// "image" (front) is required by the controllers below; "backImage" is optional — scanning/saving
// the back of the card is opt-in.
const cardImages = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'backImage', maxCount: 1 },
]);

router.use(requireAuth);

router.post('/scan', requireRole('b2b_agent'), cardImages, asyncHandler(ctrl.scanCard));
router.post('/', requireRole('b2b_agent'), cardImages, asyncHandler(ctrl.createContact));
router.get('/mine', requireRole('b2b_agent'), asyncHandler(ctrl.listMine));
router.get('/mine/export', requireRole('b2b_agent'), asyncHandler(ctrl.exportMine));
router.get('/', requireRole('super_admin'), asyncHandler(ctrl.listAll));
router.delete('/:id', requireRole('b2b_agent', 'super_admin'), asyncHandler(ctrl.deleteContact));

module.exports = router;
