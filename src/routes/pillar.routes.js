const express = require('express');
const { requireClientRole } = require('../middleware/contentAccess');
const ctrl = require('../controllers/pillar.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(ctrl.listPillars));
router.post('/', requireClientRole('owner'), asyncHandler(ctrl.createPillar));
router.patch('/:id', requireClientRole('owner'), asyncHandler(ctrl.updatePillar));
router.delete('/:id', requireClientRole('owner'), asyncHandler(ctrl.deletePillar));

module.exports = router;
