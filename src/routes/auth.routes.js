const express = require('express');
const requireAuth = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/signup', asyncHandler(ctrl.signup));
router.post('/login', asyncHandler(ctrl.login));
router.post('/google', asyncHandler(ctrl.loginWithGoogle));
router.post('/logout', asyncHandler(ctrl.logout));
router.post('/forgot-password', asyncHandler(ctrl.forgotPassword));
router.get('/me', requireAuth, asyncHandler(ctrl.me));
router.post('/change-password', requireAuth, asyncHandler(ctrl.changePassword));

module.exports = router;
