const express = require('express');
const multer = require('multer');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/department.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(requireAuth);
// Office Portal is admin/super admin only — requireRole('admin') also passes super admins (see
// utils/roles.hasRequiredRole).
router.use(requireRole('admin'));

router.get('/', asyncHandler(ctrl.listDepartments));
router.post('/', asyncHandler(ctrl.createDepartment));
router.patch('/:id', asyncHandler(ctrl.updateDepartment));
router.delete('/:id', asyncHandler(ctrl.deleteDepartment));

router.post('/:id/document/link', asyncHandler(ctrl.setDocumentLink));
router.post('/:id/document/upload', upload.single('file'), asyncHandler(ctrl.uploadDocument));
router.get('/:id/document/file', asyncHandler(ctrl.downloadDocument));
router.delete('/:id/document', asyncHandler(ctrl.removeDocument));

module.exports = router;
