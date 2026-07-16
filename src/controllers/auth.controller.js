const User = require('../models/User');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { signToken, setAuthCookie, clearAuthCookie } = require('../utils/token');

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

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await user.comparePassword(password);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

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

async function forgotPassword(req, res) {
  const { email, phone, newPassword } = req.body;
  if (!email || !phone || !newPassword) {
    return res.status(400).json({ error: 'email, phone and newPassword are required' });
  }
  if ([email, phone, newPassword].some((v) => typeof v !== 'string')) {
    return res.status(400).json({ error: 'email, phone and newPassword must be strings' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !user.phone || user.phone !== phone.trim()) {
    return res.status(401).json({ error: 'No account matches that email and phone number' });
  }

  await user.setPassword(newPassword);
  await user.save();
  return res.json({ message: 'Password updated. You can now log in with your new password.' });
}

module.exports = { signup, login, loginWithGoogle, logout, me, changePassword, forgotPassword };
