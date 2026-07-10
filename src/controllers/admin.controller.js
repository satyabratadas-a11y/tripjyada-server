const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { diffFields, recordAudit } = require('../utils/audit');
const { sendApprovalEmail } = require('../utils/email');
const { USER_ROLES } = require('../utils/roles');

const USER_STATUSES = ['pending', 'active', 'disabled'];

async function countActiveSuperAdmins() {
  return User.countDocuments({ role: 'super_admin', status: 'active' });
}

async function protectFinalSuperAdmin(user, nextRole, nextStatus) {
  const currentRole = user.role;
  const currentStatus = user.status;

  const losesSuperAdmin = currentRole === 'super_admin' && nextRole !== 'super_admin';
  const losesActiveStatus = currentRole === 'super_admin' && currentStatus === 'active' && nextStatus !== 'active';

  if (!losesSuperAdmin && !losesActiveStatus) return;

  const activeSuperAdmins = await countActiveSuperAdmins();
  if (activeSuperAdmins <= 1) {
    const reason = losesActiveStatus
      ? 'You cannot disable the last active super admin account'
      : 'You cannot remove the last super admin role';
    const error = new Error(reason);
    error.status = 400;
    throw error;
  }
}

async function listUsers(req, res) {
  const { status } = req.query;
  if (status !== undefined && !USER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${USER_STATUSES.join(', ')}` });
  }
  const filter = status ? { status } : {};
  const users = await User.find(filter).sort({ createdAt: -1 });
  return res.json({ users: users.map((u) => u.toSafeJSON()) });
}

async function approveUser(req, res) {
  const { id } = req.params;
  const { role, jobTitle } = req.body;

  if (role && !USER_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${USER_ROLES.join(', ')}` });
  }

  const user = await User.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const before = { role: user.role, jobTitle: user.jobTitle, status: user.status };
  user.status = 'active';
  if (role) user.role = role;
  if (jobTitle !== undefined) user.jobTitle = String(jobTitle).trim();
  await user.save();

  await recordAudit({
    actor: req.user,
    action: 'user.approved',
    targetType: 'user',
    targetId: user._id,
    targetLabel: user.name,
    summary: `Approved ${user.name} for access as ${user.role}`,
    changes: diffFields(before, user, ['role', 'jobTitle', 'status']),
    metadata: { email: user.email },
  });

  await sendApprovalEmail(user).catch((err) => {
    console.error('[email] failed to send approval email:', err);
  });

  return res.json({ user: user.toSafeJSON() });
}

async function updateUser(req, res) {
  const { id } = req.params;
  const { role, jobTitle, status, name } = req.body;

  if (role && !USER_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${USER_ROLES.join(', ')}` });
  }
  if (status && !USER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${USER_STATUSES.join(', ')}` });
  }
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const user = await User.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (String(user._id) === String(req.user._id) && status && status !== 'active') {
    return res.status(400).json({ error: 'You cannot disable your own account' });
  }
  if (String(user._id) === String(req.user._id) && role && role !== user.role) {
    return res.status(400).json({ error: 'You cannot change your own system role' });
  }

  const nextRole = role || user.role;
  const nextStatus = status || user.status;
  await protectFinalSuperAdmin(user, nextRole, nextStatus);

  const before = { role: user.role, jobTitle: user.jobTitle, status: user.status, name: user.name };
  if (role) user.role = role;
  if (jobTitle !== undefined) user.jobTitle = String(jobTitle).trim();
  if (status) user.status = status;
  if (name !== undefined) user.name = String(name).trim();
  await user.save();

  await recordAudit({
    actor: req.user,
    action: 'user.updated',
    targetType: 'user',
    targetId: user._id,
    targetLabel: user.name,
    summary: `Updated ${user.name}'s account settings`,
    changes: diffFields(before, user, ['name', 'role', 'jobTitle', 'status']),
    metadata: { email: user.email },
  });

  return res.json({ user: user.toSafeJSON() });
}

async function listAuditLogs(req, res) {
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

  const { from, to } = req.query;
  const filter = {};
  if (from) {
    const fromDate = new Date(from);
    if (Number.isNaN(fromDate.getTime())) {
      return res.status(400).json({ error: 'from must be a valid date' });
    }
    filter.createdAt = { ...filter.createdAt, $gte: fromDate };
  }
  if (to) {
    const toDate = new Date(to);
    if (Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ error: 'to must be a valid date' });
    }
    toDate.setUTCHours(23, 59, 59, 999);
    filter.createdAt = { ...filter.createdAt, $lte: toDate };
  }

  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit);
  return res.json({
    logs: logs.map((log) => ({
      id: String(log._id),
      actor: {
        id: String(log.actor),
        name: log.actorName,
        role: log.actorRole,
      },
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      targetLabel: log.targetLabel,
      summary: log.summary,
      changes: log.changes || {},
      metadata: log.metadata || {},
      createdAt: log.createdAt,
    })),
  });
}

module.exports = { listUsers, approveUser, updateUser, listAuditLogs };
