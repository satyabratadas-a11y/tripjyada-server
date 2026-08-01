const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const ContentEntry = require('../models/ContentEntry');
const Task = require('../models/Task');
const Project = require('../models/Project');
const User = require('../models/User');
const { isAdminLike, isSuperAdmin, isB2BAgent } = require('../utils/roles');
const { publish, subscribe } = require('../utils/notificationBus');
const { startOfTodayUTC } = require('../utils/projectStatus');
const { startOfDayIST, addDays, isSundayIST, minutesSinceMidnightIST } = require('../utils/istTime');

// The profile-picture avatar shown next to a notification — the person it's about/from (who
// assigned, commented, was flagged, etc.), or null for one about the recipient's own work, which
// gets the plain type icon instead (matches how Facebook-style feeds only show a face for
// notifications that are genuinely about another person).
function actorFrom(u) {
  // An unpopulated ObjectId (or a deleted actor) has no name and is not useful to the client.
  if (!u?._id || !u.name) return null;
  return { id: String(u._id), name: u.name, avatarUrl: User.resolveAvatarUrl(u) };
}

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
    actor: actorFrom(n.actor),
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
    .select('client date format status createdAt')
    .limit(20);

  return entries.map((e) => {
    // The notification becomes active 24 hours before the deadline. If the entry was created
    // inside that window, it cannot predate the entry itself.
    const triggerAt = new Date(e.date.getTime() - 24 * 60 * 60 * 1000);
    const createdAt = e.createdAt && e.createdAt > triggerAt ? e.createdAt : triggerAt;
    return {
      id: `due-${e._id}`,
      type: 'due_soon',
      message: `Your ${e.format} is due ${new Date(e.date).toLocaleDateString()} and isn't scheduled yet`,
      link: `/content/${e.client}/table`,
      client: e.client,
      entry: e._id,
      read: isClearedBefore(createdAt, user),
      createdAt,
      actor: null,
    };
  });
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
    .populate('employee', 'name avatarUpdatedAt avatarUrl')
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
        actor: actorFrom(task.employee),
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
      actor: null,
    };
  });
}

async function buildTaskAlerts(user) {
  if (isAdminLike(user)) return buildAdminTaskAlerts(user);
  return buildEmployeeTaskAlerts(user);
}

function formatProjectLabel(title) {
  const value = String(title || '').trim();
  if (!value) return 'A project';
  return value.length > 56 ? `${value.slice(0, 53)}...` : value;
}

function formatProjectDate(date) {
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Overdue is computed live from the same (status, endDate) shape isProjectOverdue uses, rather
// than importing it directly, so this stays a plain query the Project index can serve.
async function findOverdueProjects(extraFilter = {}) {
  return Project.find({
    ...extraFilter,
    status: { $ne: 'completed' },
    endDate: { $lt: startOfTodayUTC() },
  })
    .populate('employee', 'name avatarUpdatedAt avatarUrl')
    .sort({ endDate: -1 })
    .limit(40);
}

async function buildAdminProjectAlerts(user) {
  const visibleRoles = isSuperAdmin(user) ? ['employee', 'admin'] : ['employee'];
  const visibleEmployees = await User.find({ role: { $in: visibleRoles } }).select('_id');
  const projects = await findOverdueProjects({ employee: { $in: visibleEmployees.map((e) => e._id) } });

  return projects
    .filter((project) => project.employee)
    .map((project) => {
      const title = formatProjectLabel(project.title);
      const employeeName = project.employee.name || 'An employee';
      const dueDate = formatProjectDate(project.endDate);
      const createdAt = project.endDate;

      return {
        id: `project-overdue-${project._id}`,
        type: 'project_overdue',
        message: `${employeeName}'s project "${title}" is overdue (was due ${dueDate}).`,
        link: '/admin/projects',
        client: null,
        entry: null,
        read: isClearedBefore(createdAt, user),
        createdAt,
        actor: actorFrom(project.employee),
      };
    });
}

async function buildEmployeeProjectAlerts(user) {
  const projects = await findOverdueProjects({ employee: user._id });

  return projects.map((project) => {
    const title = formatProjectLabel(project.title);
    const createdAt = project.endDate;

    return {
      id: `project-overdue-${project._id}`,
      type: 'project_overdue',
      message: `Your project "${title}" is overdue (was due ${formatProjectDate(project.endDate)}).`,
      link: '/employee/projects',
      client: null,
      entry: null,
      read: isClearedBefore(createdAt, user),
      createdAt,
      actor: null,
    };
  });
}

async function buildProjectAlerts(user) {
  if (isAdminLike(user)) return buildAdminProjectAlerts(user);
  return buildEmployeeProjectAlerts(user);
}

const TASK_REMINDER_CUTOFF_MINUTES = 11 * 60 + 30; // 11:30 AM IST

/**
 * "You haven't added a task yet today" — fires for any caller (employee or an admin self-logging
 * via My Today) once it's past 11:30 AM IST and they have no Task row for today. Skipped on
 * Sunday, an optional day nobody is expected to have logged anything for yet, and skipped
 * entirely for a b2b_agent — their workflow (scanning cards, managing contacts) never creates a
 * Task row, so this would otherwise nag them permanently with a link to a page their role can't
 * even open. Recomputed live on every fetch, like the other alerts, so it clears itself the
 * moment a task is added — no cron.
 */
async function buildTaskReminderAlert(user) {
  if (isB2BAgent(user)) return [];

  const now = new Date();
  if (isSundayIST(now)) return [];
  if (minutesSinceMidnightIST(now) < TASK_REMINDER_CUTOFF_MINUTES) return [];

  const todayStart = startOfDayIST(now);
  const reminderCreatedAt = new Date(todayStart.getTime() + TASK_REMINDER_CUTOFF_MINUTES * 60 * 1000);
  const count = await Task.countDocuments({ employee: user._id, date: { $gte: todayStart, $lt: addDays(todayStart, 1) } });
  if (count > 0) return [];

  return [
    {
      id: `task-reminder-${user._id}-${dateKey(todayStart)}`,
      type: 'task_reminder',
      message: "You haven't added a task yet today — add one before your day wraps up.",
      link: isAdminLike(user) ? '/admin/my-today' : '/employee/today',
      client: null,
      entry: null,
      read: isClearedBefore(reminderCreatedAt, user),
      createdAt: reminderCreatedAt,
      actor: null,
    },
  ];
}

const TASK_GAP_DAYS = 3;

function buildEmployeeLink(employeeId, date) {
  const day = dateKey(date);
  return `/admin/employees/${employeeId}?month=${Number(day.slice(5, 7))}&year=${Number(day.slice(0, 4))}`;
}

/**
 * Admin-only: flags any visible employee with zero logged tasks across the last 3 full IST days
 * (not counting today, which isn't over) — the same live, no-cron approach as the other alerts.
 * Skips an employee whose account is younger than the window itself, so a brand-new hire isn't
 * flagged for a history that predates them.
 */
async function buildTaskGapAlert(user) {
  if (!isAdminLike(user)) return [];

  const visibleRoles = isSuperAdmin(user) ? ['employee', 'admin'] : ['employee'];
  const employees = await User.find({ role: { $in: visibleRoles }, status: 'active' })
    .select('name createdAt avatarUpdatedAt avatarUrl');
  if (employees.length === 0) return [];

  const todayStart = startOfDayIST();
  const windowStart = addDays(todayStart, -TASK_GAP_DAYS);

  const recentTasks = await Task.find({
    employee: { $in: employees.map((e) => e._id) },
    date: { $gte: windowStart, $lt: todayStart },
  }).select('employee');
  const employeesWithRecentTask = new Set(recentTasks.map((t) => String(t.employee)));

  return employees
    .filter((e) => e.createdAt <= windowStart && !employeesWithRecentTask.has(String(e._id)))
    .map((e) => ({
      id: `task-gap-${e._id}-${dateKey(todayStart)}`,
      type: 'task_gap',
      message: `${e.name} hasn't logged any tasks in the last ${TASK_GAP_DAYS} days.`,
      link: buildEmployeeLink(e._id, todayStart),
      client: null,
      entry: null,
      read: isClearedBefore(todayStart, user),
      createdAt: todayStart,
      actor: actorFrom(e),
    }));
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
    actor: actorFrom(u),
  }));
}

const DIRECT_MESSAGE_MAX_LENGTH = 500;

/**
 * Every active user except the caller, any role — the picker for the push-notification panel.
 * Unlike admin.controller.js's listDirectory (admin-only, employee/admin visibility only), this
 * is reachable by any authenticated user and includes every role, because anyone can notify
 * anyone here.
 */
async function listRecipients(req, res) {
  const users = await User.find({ status: 'active', _id: { $ne: req.user._id } })
    .select('name email jobTitle role')
    .sort({ name: 1 });
  return res.json({
    users: users.map((u) => ({ id: u._id, name: u.name, email: u.email, jobTitle: u.jobTitle, role: u.role })),
  });
}

/**
 * Lets any authenticated user push a one-off notification to any other active user(s) — not
 * gated by role, unlike every other notification in this file, which fires automatically from a
 * system event (assignment, approval, ...). One Notification document per recipient so each
 * person's read state is independent.
 */
async function sendNotification(req, res) {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is required' });
  if (message.length > DIRECT_MESSAGE_MAX_LENGTH) {
    return res.status(400).json({ error: `Message must be ${DIRECT_MESSAGE_MAX_LENGTH} characters or fewer` });
  }

  const requestedIds = Array.isArray(req.body.userIds) ? req.body.userIds : [];
  const validIds = requestedIds.filter((id) => mongoose.isValidObjectId(id) && String(id) !== String(req.user._id));
  if (validIds.length === 0) return res.status(400).json({ error: 'At least one recipient is required' });

  const recipients = await User.find({ _id: { $in: validIds }, status: 'active' }).select('_id');
  if (recipients.length === 0) return res.status(400).json({ error: 'At least one recipient is required' });

  await Notification.insertMany(recipients.map((r) => ({ user: r._id, actor: req.user._id, type: 'direct', message })));
  recipients.forEach((r) => publish(r._id));

  return res.status(201).json({ count: recipients.length });
}

/**
 * Server-Sent Events stream — pushed a "refresh now" nudge the instant this user gets a new
 * persisted notification (see utils/notificationBus.js), instead of waiting for the client's next
 * poll. The client still polls on an interval too, so a dropped/never-connected stream (e.g. a
 * proxy that buffers SSE) degrades to the old polling behavior rather than losing notifications.
 */
function streamNotifications(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // "no-transform" also tells the compression middleware upstream to leave this response alone
    // — gzip's own internal buffering would otherwise delay every event past the point of SSE.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');

  const nudge = () => res.write(`data: ${Date.now()}\n\n`);
  const unsubscribe = subscribe(req.user._id, nudge);
  // Keeps intermediate proxies (and the browser's own timeout) from treating an idle-but-alive
  // connection as dead.
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

async function listNotifications(req, res) {
  // Each of these is an independent read (none depends on another's result), so they run
  // concurrently rather than one-after-another — on a remote database this is the difference
  // between roughly one round trip and seven, every time this polls.
  const [persisted, dueSoon, taskAlerts, projectAlerts, taskReminderAlerts, taskGapAlerts, signupAlerts] = await Promise.all([
    Notification.find({ user: req.user._id })
      .populate('actor', 'name avatarUpdatedAt avatarUrl')
      .sort({ createdAt: -1 })
      .limit(100),
    buildDueSoon(req.user),
    buildTaskAlerts(req.user),
    buildProjectAlerts(req.user),
    buildTaskReminderAlert(req.user),
    buildTaskGapAlert(req.user),
    isSuperAdmin(req.user) ? buildPendingSignupAlerts(req.user) : Promise.resolve([]),
  ]);
  const notifications = sortNotifications([
    ...dueSoon,
    ...taskAlerts,
    ...projectAlerts,
    ...taskReminderAlerts,
    ...taskGapAlerts,
    ...signupAlerts,
    ...persisted.map(serialize),
  ]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return res.json({
    notifications,
    unreadCount,
  });
}

async function markRead(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Notification not found' });
  const notification = await Notification.findOne({ _id: req.params.id, user: req.user._id })
    .populate('actor', 'name avatarUpdatedAt avatarUrl');
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

module.exports = { listNotifications, markRead, markAllRead, listRecipients, sendNotification, streamNotifications };
