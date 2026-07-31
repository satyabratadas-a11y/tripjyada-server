const express = require('express');
const multer = require('multer');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/department.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listDepartments));
router.post('/', requireRole('admin'), asyncHandler(ctrl.createDepartment));
router.patch('/:id', requireRole('admin'), asyncHandler(ctrl.updateDepartment));
router.delete('/:id', requireRole('admin'), asyncHandler(ctrl.deleteDepartment));

router.post('/:id/document/link', requireRole('admin'), asyncHandler(ctrl.setDocumentLink));
router.post('/:id/document/upload', requireRole('admin'), upload.single('file'), asyncHandler(ctrl.uploadDocument));
router.delete('/:id/document', requireRole('admin'), asyncHandler(ctrl.removeDocument));

module.exports = router;
