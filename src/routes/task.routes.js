const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/task.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth);

router.get('/today', asyncHandler(ctrl.getToday));
router.get('/today/mine', asyncHandler(ctrl.getOwnToday));
router.get('/', asyncHandler(ctrl.listTasks));
router.post('/', requireRole('admin'), asyncHandler(ctrl.createOrAssignTask));
router.post('/self', requireRole('employee', 'admin'), asyncHandler(ctrl.employeeCreateTask));
router.patch('/:id/admin', requireRole('admin'), asyncHandler(ctrl.adminUpdateTask));
router.patch('/:id/employee', asyncHandler(ctrl.employeeUpdateTask));
router.delete('/:id', asyncHandler(ctrl.deleteTask));

module.exports = router;
