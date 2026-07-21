const express = require('express');
const multer = require('multer');
const requireAuth = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
// memoryStorage so the avatar buffer streams straight to Cloudinary (see utils/cloudinary.js)
// without ever touching disk; 5MB is plenty for a profile photo.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/signup', asyncHandler(ctrl.signup));
router.post('/login', asyncHandler(ctrl.login));
router.post('/google', asyncHandler(ctrl.loginWithGoogle));
router.post('/logout', asyncHandler(ctrl.logout));
router.post('/forgot-password', asyncHandler(ctrl.forgotPassword));
router.get('/me', requireAuth, asyncHandler(ctrl.me));
router.patch('/me', requireAuth, asyncHandler(ctrl.updateMe));
router.post('/me/avatar', requireAuth, upload.single('avatar'), asyncHandler(ctrl.updateAvatar));
router.delete('/me/avatar', requireAuth, asyncHandler(ctrl.removeAvatar));
router.post('/change-password', requireAuth, asyncHandler(ctrl.changePassword));

module.exports = router;
