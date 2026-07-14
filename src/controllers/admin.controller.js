const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Task = require('../models/Task');
const Client = require('../models/Client');
const { diffFields, recordAudit } = require('../utils/audit');
const { sendApprovalEmail } = require('../utils/email');
const { USER_ROLES } = require('../utils/roles');
const { startOfMonth, endOfMonthExclusive, rollupTasks } = require('../utils/scoring');

const USER_STATUSES = ['pending', 'active', 'disabled'];
const ADMIN_ROLES = ['admin', 'super_admin'];

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

function parseMonthYear(query) {
  const now = new Date();
  const month = parseInt(query.month, 10) || now.getUTCMonth() + 1;
  const year = parseInt(query.year, 10) || now.getUTCFullYear();

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    const error = new Error('month must be between 1 and 12');
    error.status = 400;
    throw error;
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    const error = new Error('year must be between 2000 and 2100');
    error.status = 400;
    throw error;
  }

  return { month, year };
}

function startOfTodayLocal() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfTodayLocal() {
  const end = startOfTodayLocal();
  end.setDate(end.getDate() + 1);
  return end;
}

function serializeAuditLog(log) {
  return {
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
  };
}

function deriveAttentionState(user, metrics) {
  if (user.status !== 'active') return 'disabled';
  if (metrics.reviewsToday > 0 || metrics.activityScore >= 18) return 'active';
  if (metrics.activityScore === 0) return 'idle';
  return 'watch';
}

async function getSuperDashboard(req, res) {
  const { month, year } = parseMonthYear(req.query);
  const rangeStart = startOfMonth(year, month);
  const rangeEnd = endOfMonthExclusive(year, month);
  const todayStart = startOfTodayLocal();
  const todayEnd = endOfTodayLocal();

  const [adminUsers, userCounts, clientCounts, taskCounts, monthAdminLogs, recentAdminLogs, latestAdminActions, monthTasks] =
    await Promise.all([
      User.find({ role: { $in: ADMIN_ROLES } }).sort({ role: 1, status: 1, name: 1 }).lean(),
      Promise.all([
        User.countDocuments({}),
        User.countDocuments({ status: 'active' }),
        User.countDocuments({ status: 'pending' }),
        User.countDocuments({ status: 'disabled' }),
        User.countDocuments({ role: 'admin' }),
        User.countDocuments({ role: 'super_admin' }),
        User.countDocuments({ role: 'employee' }),
        User.countDocuments({ role: 'employee', status: 'active' }),
      ]),
      Promise.all([Client.countDocuments({ status: 'active' }), Client.countDocuments({ status: 'archived' })]),
      Promise.all([
        Task.countDocuments({ date: { $gte: rangeStart, $lt: rangeEnd } }),
        Task.countDocuments({ date: { $gte: rangeStart, $lt: rangeEnd }, adminStatus: 'completed' }),
        Task.countDocuments({ date: { $gte: rangeStart, $lt: rangeEnd }, adminStatus: 'on_progress' }),
        Task.countDocuments({ date: { $gte: rangeStart, $lt: rangeEnd }, adminStatus: 'pending' }),
        Task.countDocuments({ date: { $gte: rangeStart, $lt: rangeEnd }, adminStatus: 'flagged' }),
        Task.countDocuments({ date: { $gte: rangeStart, $lt: rangeEnd }, adminStatus: 'incomplete' }),
      ]),
      AuditLog.find({
        actorRole: { $in: ADMIN_ROLES },
        createdAt: { $gte: rangeStart, $lt: rangeEnd },
      })
        .sort({ createdAt: -1 })
        .lean(),
      AuditLog.find({ actorRole: { $in: ADMIN_ROLES } }).sort({ createdAt: -1 }).limit(12).lean(),
      AuditLog.aggregate([
        { $match: { actorRole: { $in: ADMIN_ROLES } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$actor',
            createdAt: { $first: '$createdAt' },
            summary: { $first: '$summary' },
            action: { $first: '$action' },
          },
        },
      ]),
      Task.find({ date: { $gte: rangeStart, $lt: rangeEnd } })
        .populate('employee', 'name jobTitle role status')
        .lean(),
    ]);

  const [
    totalUsers,
    activeUsers,
    pendingUsers,
    disabledUsers,
    totalAdmins,
    totalSuperAdmins,
    totalEmployees,
    activeEmployees,
  ] = userCounts;
  const [activeClients, archivedClients] = clientCounts;
  const [tasksThisMonth, completedThisMonth, onProgressThisMonth, pendingReviewThisMonth, flaggedThisMonth, incompleteThisMonth] =
    taskCounts;

  const latestActionMap = new Map(latestAdminActions.map((entry) => [String(entry._id), entry]));
  const monthMetricsMap = new Map();

  for (const log of monthAdminLogs) {
    const actorId = String(log.actor);
    if (!monthMetricsMap.has(actorId)) {
      monthMetricsMap.set(actorId, {
        reviewsToday: 0,
        reviewsThisMonth: 0,
        assignmentsThisMonth: 0,
        approvalsThisMonth: 0,
        flaggedThisMonth: 0,
      });
    }

    const metrics = monthMetricsMap.get(actorId);
    const createdAt = new Date(log.createdAt);
    const isToday = createdAt >= todayStart && createdAt < todayEnd;

    if (log.action === 'task.reviewed') {
      metrics.reviewsThisMonth += 1;
      if (isToday) metrics.reviewsToday += 1;
      if (log.changes?.adminStatus?.after === 'flagged') {
        metrics.flaggedThisMonth += 1;
      }
    } else if (log.action === 'task.assigned') {
      metrics.assignmentsThisMonth += 1;
    } else if (log.action === 'user.approved') {
      metrics.approvalsThisMonth += 1;
    }
  }

  const adminRows = adminUsers.map((user) => {
    const metrics = monthMetricsMap.get(String(user._id)) || {
      reviewsToday: 0,
      reviewsThisMonth: 0,
      assignmentsThisMonth: 0,
      approvalsThisMonth: 0,
      flaggedThisMonth: 0,
    };

    const activityScore =
      metrics.reviewsThisMonth * 3 +
      metrics.assignmentsThisMonth * 2 +
      metrics.approvalsThisMonth * 4 +
      metrics.reviewsToday * 2;

    const lastAction = latestActionMap.get(String(user._id));

    return {
      admin: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        jobTitle: user.jobTitle || '',
        status: user.status,
      },
      ...metrics,
      activityScore,
      attentionState: deriveAttentionState(user, { ...metrics, activityScore }),
      lastActionAt: lastAction?.createdAt || null,
      lastActionSummary: lastAction?.summary || '',
    };
  });

  const employeeTaskMap = new Map();
  for (const task of monthTasks) {
    const employee = task.employee;
    if (!employee || employee.role !== 'employee') continue;
    const employeeId = String(employee._id);
    if (!employeeTaskMap.has(employeeId)) {
      employeeTaskMap.set(employeeId, {
        employee: {
          id: employeeId,
          name: employee.name,
          jobTitle: employee.jobTitle || '',
        },
        tasks: [],
        pendingCount: 0,
        flaggedCount: 0,
        incompleteCount: 0,
        lastUpdateAt: null,
      });
    }

    const row = employeeTaskMap.get(employeeId);
    row.tasks.push(task);
    if (task.adminStatus === 'pending') row.pendingCount += 1;
    if (task.adminStatus === 'flagged') row.flaggedCount += 1;
    if (task.adminStatus === 'incomplete') row.incompleteCount += 1;

    const stamp = task.updatedAt || task.createdAt || task.date;
    if (!row.lastUpdateAt || new Date(stamp) > new Date(row.lastUpdateAt)) {
      row.lastUpdateAt = stamp;
    }
  }

  const employeeWatch = Array.from(employeeTaskMap.values())
    .map((row) => {
      const rollup = rollupTasks(row.tasks);
      return {
        employee: row.employee,
        taskCount: row.tasks.length,
        pendingCount: row.pendingCount,
        flaggedCount: row.flaggedCount,
        incompleteCount: row.incompleteCount,
        progressPct: rollup.progressPct,
        lastUpdateAt: row.lastUpdateAt,
      };
    })
    .filter((row) => row.pendingCount > 0 || row.flaggedCount > 0 || row.incompleteCount > 0)
    .sort((a, b) => {
      if (b.flaggedCount !== a.flaggedCount) return b.flaggedCount - a.flaggedCount;
      if (b.pendingCount !== a.pendingCount) return b.pendingCount - a.pendingCount;
      if (b.incompleteCount !== a.incompleteCount) return b.incompleteCount - a.incompleteCount;
      return new Date(b.lastUpdateAt || 0).getTime() - new Date(a.lastUpdateAt || 0).getTime();
    })
    .slice(0, 8);

  const platform = {
    totalUsers,
    activeUsers,
    pendingUsers,
    disabledUsers,
    totalAdmins,
    totalSuperAdmins,
    totalEmployees,
    activeEmployees,
    activeClients,
    archivedClients,
    tasksThisMonth,
    completedThisMonth,
    onProgressThisMonth,
    pendingReviewThisMonth,
    flaggedThisMonth,
    incompleteThisMonth,
    reviewsThisMonth: monthAdminLogs.filter((log) => log.action === 'task.reviewed').length,
    assignmentsThisMonth: monthAdminLogs.filter((log) => log.action === 'task.assigned').length,
    approvalsThisMonth: monthAdminLogs.filter((log) => log.action === 'user.approved').length,
  };

  return res.json({
    month,
    year,
    platform,
    adminRows,
    employeeWatch,
    recentActions: recentAdminLogs.map(serializeAuditLog),
  });
}

module.exports = { listUsers, approveUser, updateUser, listAuditLogs, getSuperDashboard };
