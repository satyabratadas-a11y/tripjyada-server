const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/task.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth);

router.get('/today', asyncHandler(ctrl.getToday));
router.get('/today/mine', asyncHandler(ctrl.getOwnToday));
router.get('/search', requireRole('admin'), asyncHandler(ctrl.searchTasks));
router.get('/', asyncHandler(ctrl.listTasks));
router.post('/', requireRole('admin'), asyncHandler(ctrl.createOrAssignTask));
router.post('/self', requireRole('employee', 'admin'), asyncHandler(ctrl.employeeCreateTask));
// Must come before /:id/admin — otherwise "bulk" would be captured as the :id param and this
// route would never be reached.
router.patch('/bulk/admin', requireRole('admin'), asyncHandler(ctrl.bulkAdminUpdate));
router.patch('/:id/admin', requireRole('admin'), asyncHandler(ctrl.adminUpdateTask));
router.patch('/:id/employee', asyncHandler(ctrl.employeeUpdateTask));
router.delete('/:id', asyncHandler(ctrl.deleteTask));

module.exports = router;
