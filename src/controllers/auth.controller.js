const User = require('../models/User');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { signToken, setAuthCookie, clearAuthCookie } = require('../utils/token');
const { isUploadEnabled, uploadBuffer } = require('../utils/cloudinary');
const { createResetToken, hashResetToken, isRateLimited } = require('../utils/passwordReset');
const { sendPasswordResetEmail } = require('../utils/email');

let googleClient;

function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID || '';
}

function getGoogleClient() {
  if (!googleClient) {
    googleClient = new OAuth2Client();
  }
  return googleClient;
}

function randomPassword() {
  return crypto.randomBytes(24).toString('hex');
}

async function verifyGoogleCredential(credential) {
  const clientId = getGoogleClientId();
  if (!clientId) {
    const error = new Error('Google login is not configured. Add GOOGLE_CLIENT_ID on the server and NEXT_PUBLIC_GOOGLE_CLIENT_ID on the client.');
    error.status = 503;
    throw error;
  }

  const ticket = await getGoogleClient().verifyIdToken({
    idToken: credential,
    audience: clientId,
  });

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    const error = new Error('Google account could not be verified');
    error.status = 401;
    throw error;
  }

  return payload;
}

async function signup(req, res) {
  const { name, email, password, jobTitle, employeeCode, phone } = req.body;
  if (!name || !email || !password || !employeeCode || !phone) {
    return res.status(400).json({ error: 'name, email, phone, employeeCode and password are required' });
  }
  if ([name, email, password, employeeCode, phone].some((v) => typeof v !== 'string')) {
    return res.status(400).json({ error: 'name, email, phone, employeeCode and password must be strings' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const trimmedEmployeeCode = employeeCode.trim();
  const trimmedPhone = phone.trim();

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const existingCode = await User.findOne({ employeeCode: trimmedEmployeeCode });
  if (existingCode) return res.status(409).json({ error: 'An account with this employee ID already exists' });

  const user = new User({
    name,
    email,
    jobTitle,
    employeeCode: trimmedEmployeeCode,
    phone: trimmedPhone,
    role: 'employee',
    status: 'pending',
  });
  await user.setPassword(password);
  await user.save();

  return res.status(201).json({
    message: 'Account created. A super admin must approve it before you can log in.',
    user: user.toSafeJSON(),
  });
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password must be strings' });
  }

  // "Invalid email or password" is deliberately generic to the user (never confirm whether an
  // email is registered), but that leaves support blind — every failed-login report otherwise
  // means manually digging through the DB to find out which of these two cases it was. The email
  // itself isn't sensitive, so it's safe to log; the password never is and never gets logged.
  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    console.log(`[auth] login failed — no account for ${normalizedEmail}`);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await user.comparePassword(password);
  if (!valid) {
    // A Google-first account (see loginWithGoogle below) gets a random password the user never
    // sees and never set themselves, plus no phone on file — so typing a guessed password here
    // fails exactly like a wrong password, and "Forgot password" can't rescue them either (it
    // requires a phone match). That reads as a broken account; it's actually just the wrong login
    // method, so say so instead of the generic message.
    if (user.googleId) {
      console.log(`[auth] login failed — ${normalizedEmail} has a Google-linked account, no password to check against`);
      return res.status(401).json({ error: 'This account signs in with Google — use the "Continue with Google" button instead.' });
    }
    console.log(`[auth] login failed — wrong password for ${normalizedEmail} (status: ${user.status})`);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (user.status === 'pending') {
    return res.status(403).json({ error: 'Your account is awaiting super admin approval' });
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ error: 'Your account has been disabled' });
  }

  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json({ user: user.toSafeJSON() });
}

async function loginWithGoogle(req, res) {
  const { credential } = req.body;
  if (!credential || typeof credential !== 'string') {
    return res.status(400).json({ error: 'Google credential is required' });
  }

  const payload = await verifyGoogleCredential(credential);
  const email = String(payload.email).toLowerCase().trim();
  const googleId = String(payload.sub || '').trim();
  const avatarUrl = String(payload.picture || '').trim();
  const displayName = String(payload.name || email.split('@')[0] || 'Google User').trim();

  let user = await User.findOne({
    $or: [{ email }, ...(googleId ? [{ googleId }] : [])],
  });

  if (!user) {
    user = new User({
      name: displayName,
      email,
      googleId,
      avatarUrl,
      role: 'employee',
      status: 'pending',
    });
    await user.setPassword(randomPassword());
    await user.save();

    return res.status(200).json({
      pending: true,
      message: 'Google account linked. A super admin must approve your account before you can log in.',
    });
  }

  let changed = false;
  if (googleId && user.googleId !== googleId) {
    user.googleId = googleId;
    changed = true;
  }
  if (avatarUrl && user.avatarUrl !== avatarUrl) {
    user.avatarUrl = avatarUrl;
    changed = true;
  }
  if (!user.name && displayName) {
    user.name = displayName;
    changed = true;
  }
  if (changed) await user.save();

  if (user.status === 'pending') {
    return res.status(200).json({
      pending: true,
      message: 'Google account linked. Your account is awaiting super admin approval.',
    });
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ error: 'Your account has been disabled' });
  }

  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json({ user: user.toSafeJSON() });
}

async function logout(req, res) {
  clearAuthCookie(res);
  return res.json({ message: 'Logged out' });
}

async function me(req, res) {
  return res.json({ user: req.user.toSafeJSON() });
}

async function updateMe(req, res) {
  const { name, email, employeeCode } = req.body;
  const user = req.user;

  if (name !== undefined) {
    const trimmedName = String(name).trim();
    if (!trimmedName) return res.status(400).json({ error: 'Name is required' });
    user.name = trimmedName;
  }

  if (email !== undefined) {
    const normalizedEmail = String(email).toLowerCase().trim();
    if (!normalizedEmail) return res.status(400).json({ error: 'Email is required' });
    if (normalizedEmail !== user.email) {
      const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
      user.email = normalizedEmail;
    }
  }

  if (employeeCode !== undefined) {
    const trimmedCode = String(employeeCode).trim();
    if (!trimmedCode) return res.status(400).json({ error: 'Employee ID is required' });
    if (trimmedCode !== user.employeeCode) {
      const existing = await User.findOne({ employeeCode: trimmedCode, _id: { $ne: user._id } });
      if (existing) return res.status(409).json({ error: 'An account with this employee ID already exists' });
      user.employeeCode = trimmedCode;
    }
  }

  await user.save();
  return res.json({ user: user.toSafeJSON() });
}

async function updateAvatar(req, res) {
  if (!isUploadEnabled()) {
    return res.status(503).json({ error: 'Profile picture uploads are not configured. Add CLOUDINARY_* keys to server/.env to enable them.' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image files are allowed' });
  }

  const result = await uploadBuffer(req.file.buffer, {
    folder: `profile-avatars/${req.user._id}`,
    resourceType: 'image',
  });
  req.user.avatarUrl = result.secure_url;
  await req.user.save();
  return res.json({ user: req.user.toSafeJSON() });
}

async function removeAvatar(req, res) {
  req.user.avatarUrl = '';
  await req.user.save();
  return res.json({ user: req.user.toSafeJSON() });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const valid = await req.user.comparePassword(currentPassword);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  await req.user.setPassword(newPassword);
  await req.user.save();
  return res.json({ message: 'Password updated' });
}

// Previously accepted { email, phone, newPassword } and reset the password immediately on a
// match — but a coworker's phone number is usually known or easily discoverable within a small
// team, which made this a full account-takeover path (including onto admin/super admin accounts)
// with zero proof of owning the account's inbox. Now it only emails a one-time reset link, so
// the reset requires access to the actual email account, not just two low-entropy facts about it.
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  // Same generic response whether or not the account exists, and rate-limited per email —
  // otherwise the response (or its timing) would let an attacker enumerate registered emails,
  // and an unthrottled endpoint would let them spam a target's inbox with reset emails.
  const genericResponse = {
    message: 'If an account exists for that email, a password reset link has been sent to it.',
  };

  if (isRateLimited(`forgot:${normalizedEmail}`)) {
    return res.json(genericResponse);
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (user) {
    const { token, tokenHash, expiresAt } = createResetToken();
    user.resetPasswordTokenHash = tokenHash;
    user.resetPasswordExpiresAt = expiresAt;
    await user.save();
    await sendPasswordResetEmail(user, token).catch((err) => {
      console.error('[email] failed to send password reset email:', err);
    });
  }

  return res.json(genericResponse);
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'token and newPassword are required' });
  }
  if (typeof token !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'token and newPassword must be strings' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const user = await User.findOne({
    resetPasswordTokenHash: hashResetToken(token),
    resetPasswordExpiresAt: { $gt: new Date() },
  });
  if (!user) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
  }

  await user.setPassword(newPassword);
  user.resetPasswordTokenHash = null;
  user.resetPasswordExpiresAt = null;
  await user.save();
  return res.json({ message: 'Password updated. You can now log in with your new password.' });
}

module.exports = {
  signup,
  login,
  loginWithGoogle,
  logout,
  me,
  updateMe,
  updateAvatar,
  removeAvatar,
  changePassword,
  forgotPassword,
  resetPassword,
};
