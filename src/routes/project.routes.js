const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/project.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth);

// Must come before /:id — otherwise "review" would be captured as the :id param.
router.get('/review', requireRole('admin'), asyncHandler(ctrl.reviewList));
router.get('/', asyncHandler(ctrl.listProjects));
router.post('/', requireRole('admin'), asyncHandler(ctrl.createOrAssignProject));
router.post('/self', requireRole('employee', 'admin'), asyncHandler(ctrl.employeeCreateProject));
router.get('/:id', asyncHandler(ctrl.getProject));
router.patch('/:id', asyncHandler(ctrl.updateProject));
router.delete('/:id', asyncHandler(ctrl.deleteProject));

module.exports = router;
