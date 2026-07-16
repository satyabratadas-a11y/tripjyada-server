const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const ContentEntry = require('../models/ContentEntry');
const Task = require('../models/Task');
const User = require('../models/User');
const { isAdminLike, isSuperAdmin } = require('../utils/roles');

function serialize(n) {
  return {
    id: n._id,
    type: n.type,
    message: n.message,
    link: n.link,
    client: n.client,
    entry: n.entry,
    read: n.read,
    createdAt: n.createdAt,
  };
}

function notificationTimestamp(value) {
  return new Date(value).getTime();
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function formatTaskDate(date) {
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTaskLabel(taskName) {
  const value = String(taskName || '').trim();
  if (!value) return 'A task';
  return value.length > 56 ? `${value.slice(0, 53)}...` : value;
}

function endOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function buildAdminTaskLink(task) {
  const day = dateKey(task.date);
  return `/admin/employees/${task.employee._id}?month=${Number(day.slice(5, 7))}&year=${Number(day.slice(0, 4))}&date=${day}`;
}

function sortNotifications(items) {
  return [...items].sort((a, b) => notificationTimestamp(b.createdAt) - notificationTimestamp(a.createdAt));
}

// Ephemeral alerts (due-soon, task reminders, pending signups) have no stored `read` flag to flip,
// so "mark all read" instead records a timestamp — anything generated at or before it counts read,
// while anything newer (e.g. a task flagged again after the last clear) still shows as unread.
function isClearedBefore(date, user) {
  if (!user.notificationsClearedAt) return false;
  return new Date(date).getTime() <= new Date(user.notificationsClearedAt).getTime();
}

/** "Due soon" reminders are computed live on every fetch rather than persisted — no cron needed. */
async function buildDueSoon(user) {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const entries = await ContentEntry.find({
    assignee: user._id,
    date: { $gte: now, $lte: soon },
    status: { $nin: ['Scheduled', 'Published'] },
  })
    .select('client date format status')
    .limit(20);

  return entries.map((e) => ({
    id: `due-${e._id}`,
    type: 'due_soon',
    message: `Your ${e.format} is due ${new Date(e.date).toLocaleDateString()} and isn't scheduled yet`,
    link: `/content/${e.client}/table`,
    client: e.client,
    entry: e._id,
    read: isClearedBefore(e.date, user),
    createdAt: e.date,
  }));
}

function shouldAlertAdminForPendingTask(task) {
  if (task.adminStatus !== 'pending') return false;
  if (task.createdBy === 'employee') return true;
  if (task.memberStatus !== 'not_started') return true;
  if (String(task.proofLink || '').trim()) return true;
  return false;
}

async function buildAdminTaskAlerts(user) {
  const tasks = await Task.find({
    adminStatus: { $in: ['pending', 'flagged'] },
    date: { $lt: endOfTodayUTC() },
  })
    .populate('employee', 'name')
    .sort({ updatedAt: -1, date: -1 })
    .limit(40);

  return tasks
    .filter((task) => task.employee)
    .filter((task) => task.adminStatus === 'flagged' || shouldAlertAdminForPendingTask(task))
    .map((task) => {
      const taskName = formatTaskLabel(task.assignedTask);
      const employeeName = task.employee.name || 'An employee';
      const taskDate = formatTaskDate(task.date);
      const createdAt = task.updatedAt || task.createdAt || task.date;

      return {
        id: `task-${task.adminStatus}-${task._id}`,
        type: task.adminStatus === 'flagged' ? 'rejected' : 'approval_requested',
        message:
          task.adminStatus === 'flagged'
            ? `${employeeName}'s task "${taskName}" is flagged for ${taskDate}.`
            : `${employeeName}'s task "${taskName}" is awaiting your review for ${taskDate}.`,
        link: buildAdminTaskLink(task),
        client: null,
        entry: null,
        read: isClearedBefore(createdAt, user),
        createdAt,
      };
    });
}

async function buildEmployeeTaskAlerts(user) {
  const tasks = await Task.find({
    employee: user._id,
    adminStatus: 'flagged',
    date: { $lt: endOfTodayUTC() },
  })
    .sort({ updatedAt: -1, date: -1 })
    .limit(25);

  return tasks.map((task) => {
    const taskName = formatTaskLabel(task.assignedTask);
    const baseMessage = `Your task "${taskName}" was flagged for ${formatTaskDate(task.date)}.`;
    const note = String(task.reviewerNotes || '').trim();
    const createdAt = task.updatedAt || task.createdAt || task.date;

    return {
      id: `task-flagged-${task._id}`,
      type: 'rejected',
      message: note ? `${baseMessage} Remark: ${note}` : baseMessage,
      link: '/employee/log',
      client: null,
      entry: null,
      read: isClearedBefore(createdAt, user),
      createdAt,
    };
  });
}

async function buildTaskAlerts(user) {
  if (isAdminLike(user)) return buildAdminTaskAlerts(user);
  return buildEmployeeTaskAlerts(user);
}

// Only a super admin can approve signups, so this alert is scoped to that role — anyone else
// seeing "new account awaiting approval" would have no way to act on it.
async function buildPendingSignupAlerts(user) {
  const pendingUsers = await User.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(40);

  return pendingUsers.map((u) => ({
    id: `signup-${u._id}`,
    type: 'signup_pending',
    message: `${u.name} just signed up and is awaiting your approval to access the platform.`,
    link: '/admin/users',
    client: null,
    entry: null,
    read: isClearedBefore(u.createdAt, user),
    createdAt: u.createdAt,
  }));
}

async function listNotifications(req, res) {
  const persisted = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
  const dueSoon = await buildDueSoon(req.user);
  const taskAlerts = await buildTaskAlerts(req.user);
  const signupAlerts = isSuperAdmin(req.user) ? await buildPendingSignupAlerts(req.user) : [];
  const notifications = sortNotifications([...dueSoon, ...taskAlerts, ...signupAlerts, ...persisted.map(serialize)]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return res.json({
    notifications,
    unreadCount,
  });
}

async function markRead(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Notification not found' });
  const notification = await Notification.findOne({ _id: req.params.id, user: req.user._id });
  if (!notification) return res.status(404).json({ error: 'Notification not found' });
  notification.read = true;
  await notification.save();
  return res.json({ notification: serialize(notification) });
}

async function markAllRead(req, res) {
  await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true } });
  req.user.notificationsClearedAt = new Date();
  await req.user.save();
  return res.status(204).send();
}

module.exports = { listNotifications, markRead, markAllRead };
