const express = require('express');
const multer = require('multer');
const { requireClientRole } = require('../middleware/contentAccess');
const ctrl = require('../controllers/contentEntry.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.get('/', asyncHandler(ctrl.listEntries));
router.get('/export', asyncHandler(ctrl.exportEntries));
router.post('/', requireClientRole('owner', 'editor'), asyncHandler(ctrl.createEntry));
router.post('/bulk', requireClientRole('owner', 'editor'), asyncHandler(ctrl.bulkCreate));
router.patch('/bulk', requireClientRole('owner', 'editor'), asyncHandler(ctrl.bulkUpdate));
router.delete('/bulk', requireClientRole('owner', 'editor'), asyncHandler(ctrl.bulkDelete));

router.get('/:id', asyncHandler(ctrl.getEntry));
router.patch('/:id', requireClientRole('owner', 'editor'), asyncHandler(ctrl.updateEntry));
router.patch('/:id/approval', requireClientRole('owner'), asyncHandler(ctrl.setApproval));
router.patch('/:id/move', requireClientRole('owner', 'editor'), asyncHandler(ctrl.moveEntry));
router.post('/:id/duplicate', requireClientRole('owner', 'editor'), asyncHandler(ctrl.duplicateEntry));
router.delete('/:id', requireClientRole('owner', 'editor'), asyncHandler(ctrl.deleteEntry));

router.post('/:id/attachments', requireClientRole('owner', 'editor'), upload.single('file'), asyncHandler(ctrl.uploadAttachment));
router.delete('/:id/attachments/:attachmentId', requireClientRole('owner', 'editor'), asyncHandler(ctrl.deleteAttachment));

router.get('/:id/comments', asyncHandler(ctrl.listComments));
router.post('/:id/comments', asyncHandler(ctrl.addComment));

module.exports = router;
