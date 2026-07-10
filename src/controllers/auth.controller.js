const User = require('../models/User');
const { signToken, setAuthCookie, clearAuthCookie } = require('../utils/token');

async function signup(req, res) {
  const { name, email, password, jobTitle, employeeCode } = req.body;
  if (!name || !email || !password || !employeeCode) {
    return res.status(400).json({ error: 'name, email, employeeCode and password are required' });
  }
  if ([name, email, password, employeeCode].some((v) => typeof v !== 'string')) {
    return res.status(400).json({ error: 'name, email, employeeCode and password must be strings' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const trimmedEmployeeCode = employeeCode.trim();

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const existingCode = await User.findOne({ employeeCode: trimmedEmployeeCode });
  if (existingCode) return res.status(409).json({ error: 'An account with this employee ID already exists' });

  const user = new User({ name, email, jobTitle, employeeCode: trimmedEmployeeCode, role: 'employee', status: 'pending' });
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

module.exports = { signup, login, logout, me, changePassword };
