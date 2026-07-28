const express = require('express');
const multer = require('multer');
const requireAuth = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
// memoryStorage gives the controller a Buffer that can be written directly to MongoDB without
// touching disk. Raw binary stays below MongoDB's document limit and avoids base64 expansion.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function uploadAvatar(req, res, next) {
  upload.single('avatar')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Profile photo must be 5MB or smaller' });
      }
      return res.status(400).json({ error: 'Invalid profile photo upload' });
    }
    if (err) return next(err);
    return next();
  });
}

router.post('/signup', asyncHandler(ctrl.signup));
router.post('/login', asyncHandler(ctrl.login));
router.post('/google', asyncHandler(ctrl.loginWithGoogle));
router.post('/logout', asyncHandler(ctrl.logout));
router.post('/forgot-password', asyncHandler(ctrl.forgotPassword));
router.get('/me', requireAuth, asyncHandler(ctrl.me));
router.patch('/me', requireAuth, asyncHandler(ctrl.updateMe));
router.get('/users/:id/avatar', requireAuth, asyncHandler(ctrl.getAvatar));
router.post('/me/avatar', requireAuth, uploadAvatar, asyncHandler(ctrl.updateAvatar));
router.delete('/me/avatar', requireAuth, asyncHandler(ctrl.removeAvatar));
router.post('/change-password', requireAuth, asyncHandler(ctrl.changePassword));

module.exports = router;
