const mongoose = require('mongoose');
const Task = require('../models/Task');
const User = require('../models/User');
const { deriveDayType, startOfMonth, endOfMonthExclusive } = require('../utils/scoring');
const { diffFields, recordAudit } = require('../utils/audit');
const { sendTaskAssignedEmail, sendTaskReviewEmail } = require('../utils/email');
const { isAdminLike, isSuperAdmin } = require('../utils/roles');

// An admin can now self-log tasks the same way an employee does, but an admin (or super admin)
// reviewing their own peer's task would defeat the point of review — so anything owned by an
// admin-or-above requires a super admin specifically, the same way an employee's task requires
// at least an admin.
function ownerOutranksAdmin(ownerRole) {
  return ownerRole === 'admin' || ownerRole === 'super_admin';
}

const ADMIN_STATUSES = ['pending', 'completed', 'on_progress', 'incomplete', 'flagged'];
const MEMBER_STATUSES = ['not_started', 'on_progress', 'done', 'not_done'];

function dayRangeUTC(dateStr) {
  const base = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function validateEnumValue(res, field, value, allowed) {
  if (value !== undefined && !allowed.includes(value)) {
    res.status(400).json({ error: `${field} must be one of: ${allowed.join(', ')}` });
    return false;
  }
  return true;
}

/**
 * Admin sees every active employee's tasks for the given day (defaults to today, and can be
 * overridden with ?date=YYYY-MM-DD to browse any day); an employee always sees only their own.
 * ?scope=own forces the caller's own tasks instead — used by an admin's personal "My Today" page,
 * since an admin-like caller would otherwise get the cross-employee oversight grid.
 *
 * The live "today" view (no ?date= override) also carries forward any task still On Progress
 * from an earlier day — whether it was left that way originally or was reopened by editing an
 * older entry in the monthly log — so unfinished work keeps surfacing here instead of getting
 * stranded on a date nobody revisits. Browsing a specific past day via ?date= is a historical
 * lookup, not the live worklist, so it only shows that day's own tasks.
 *
 * On top of that, an owner's own live view (?scope=own — an employee's personal list, or an
 * admin's own "My Today") drops a task the moment it's resolved (Done or Not Done): once there's
 * nothing left to act on, it belongs in the monthly log, not the actionable worklist. The
 * cross-employee oversight grid (admin/super admin browsing everyone) keeps showing today's
 * done work too, since that's exactly what a reviewer needs to verify same-day.
 */
async function getToday(req, res) {
  const { start, end } = dayRangeUTC(req.query.date);
  const ownOnly = req.query.scope === 'own';
  const isLiveToday = !req.query.date;

  let employees;
  if (isAdminLike(req.user) && !ownOnly) {
    const visibleRoles = isSuperAdmin(req.user) ? ['employee', 'admin', 'super_admin'] : ['employee'];
    employees = await User.find({ role: { $in: visibleRoles }, status: 'active' }).sort({ name: 1 });
  } else {
    employees = [req.user];
  }

  const employeeFilter = { employee: { $in: employees.map((e) => e._id) } };
  const dateFilter = { date: { $gte: start, $lt: end } };

  let filter;
  if (!isLiveToday) {
    filter = { ...employeeFilter, ...dateFilter };
  } else if (ownOnly) {
    filter = {
      ...employeeFilter,
      memberStatus: { $nin: ['done', 'not_done'] },
      $or: [dateFilter, { memberStatus: 'on_progress' }],
    };
  } else {
    filter = { ...employeeFilter, $or: [dateFilter, { memberStatus: 'on_progress' }] };
  }

  const tasks = await Task.find(filter).sort({ createdAt: 1 });

  const tasksByEmployee = new Map();
  for (const t of tasks) {
    const key = String(t.employee);
    if (!tasksByEmployee.has(key)) tasksByEmployee.set(key, []);
    tasksByEmployee.get(key).push(t);
  }

  const rows = employees.map((emp) => ({
    employee: { id: emp._id, name: emp.name, jobTitle: emp.jobTitle, role: emp.role },
    tasks: tasksByEmployee.get(String(emp._id)) || [],
  }));

  return res.json({ date: start, rows });
}

/**
 * Admin-like caller can request any employeeId (view-gated to super admin if that id outranks a
 * plain admin), or omit it for their own tasks; a non-admin is always forced to their own id.
 */
async function listTasks(req, res) {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  if (!month || !year) return res.status(400).json({ error: 'month and year query params are required' });

  // An admin-like caller viewing someone else's log needs an explicit employeeId; omitting it
  // (as an admin's own "My Monthly Log" page does) falls back to their own tasks, same as an
  // employee always gets.
  let employeeId;
  if (isAdminLike(req.user) && req.query.employeeId) {
    employeeId = req.query.employeeId;
    if (!mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({ error: 'employeeId query param must be a valid id' });
    }
    const target = await User.findById(employeeId);
    if (ownerOutranksAdmin(target?.role) && !isSuperAdmin(req.user)) {
      return res.status(403).json({ error: 'Only a super admin can view an admin\'s tasks' });
    }
  } else {
    employeeId = String(req.user._id);
  }

  // A task lands in the monthly log the day it's added, regardless of memberStatus — waiting for
  // "done" meant a task the owner forgot to mark done just vanished from their record instead of
  // sitting there as a visible on-progress (or not-done) entry. The live "Today" view (getToday)
  // shows the same set for the current day, just scoped differently.
  const filter = {
    employee: employeeId,
    date: { $gte: startOfMonth(year, month), $lt: endOfMonthExclusive(year, month) },
  };

  const tasks = await Task.find(filter).sort({ date: 1, createdAt: 1 });

  return res.json({ tasks });
}

/** Admin-only: assigns a new task to a given employee + date. Multiple tasks per day are allowed. */
async function createOrAssignTask(req, res) {
  const { employeeId, date, assignedTask, brief } = req.body;
  const trimmedAssignedTask = assignedTask?.trim();
  if (!employeeId || !date || !trimmedAssignedTask) {
    return res.status(400).json({ error: 'employeeId, date and assignedTask are required' });
  }
  if (!mongoose.isValidObjectId(employeeId)) {
    return res.status(400).json({ error: 'employeeId must be a valid id' });
  }

  const employee = await User.findOne({ _id: employeeId, role: 'employee', status: 'active' });
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  const day = new Date(date);
  const task = await Task.create({
    employee: employeeId,
    date: day,
    dayType: deriveDayType(day),
    createdBy: 'admin',
    assignedTask: trimmedAssignedTask,
    brief: brief ?? '',
  });

  await recordAudit({
    actor: req.user,
    action: 'task.assigned',
    targetType: 'task',
    targetId: task._id,
    targetLabel: employee.name,
    summary: `Assigned "${task.assignedTask}" to ${employee.name} for ${dateKey(task.date)}`,
    metadata: {
      employeeId: String(employee._id),
      employeeName: employee.name,
      date: dateKey(task.date),
      task: task.assignedTask,
    },
  });

  await sendTaskAssignedEmail(employee, task).catch((err) => {
    console.error('[email] failed to send assignment email:', err);
  });

  return res.status(201).json({ task });
}

/**
 * Employee-only: adds a task for themselves, always for today. Self-adding for a past or future
 * date would let a forgotten day get backfilled after the fact instead of being an honest,
 * same-day record — an admin assigning a task for another date is a separate route and unaffected.
 */
async function employeeCreateTask(req, res) {
  const { date, assignedTask, brief, proofLink, memberStatus } = req.body;
  const trimmedAssignedTask = assignedTask?.trim();
  if (!date || !trimmedAssignedTask) {
    return res.status(400).json({ error: 'date and assignedTask are required' });
  }
  const todayKey = new Date().toISOString().slice(0, 10);
  if (String(date).slice(0, 10) !== todayKey) {
    return res.status(400).json({ error: 'You can only add a task for today' });
  }
  if (!validateEnumValue(res, 'memberStatus', memberStatus, MEMBER_STATUSES)) return;

  const day = new Date(date);
  const task = await Task.create({
    employee: req.user._id,
    date: day,
    dayType: deriveDayType(day),
    createdBy: 'employee',
    assignedTask: trimmedAssignedTask,
    brief: brief ?? '',
    proofLink: proofLink ?? '',
    memberStatus: memberStatus ?? 'on_progress',
  });

  return res.status(201).json({ task });
}

const ADMIN_FIELDS = ['assignedTask', 'brief', 'adminStatus', 'reviewerNotes'];
const EMPLOYEE_OWN_TASK_FIELDS = ['assignedTask', 'brief', 'proofLink', 'memberStatus'];
const EMPLOYEE_ASSIGNED_TASK_FIELDS = ['proofLink', 'memberStatus'];

function pickWhitelisted(body, fields) {
  const update = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field];
  }
  return update;
}

async function adminUpdateTask(req, res) {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const employee = await User.findById(task.employee);
  if (ownerOutranksAdmin(employee?.role) && !isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Only a super admin can review an admin\'s task' });
  }

  const update = pickWhitelisted(req.body, ADMIN_FIELDS);
  if (!validateEnumValue(res, 'adminStatus', update.adminStatus, ADMIN_STATUSES)) return;

  const before = {
    assignedTask: task.assignedTask,
    brief: task.brief,
    adminStatus: task.adminStatus,
    reviewerNotes: task.reviewerNotes,
  };
  Object.assign(task, update);
  await task.save();

  await recordAudit({
    actor: req.user,
    action: 'task.reviewed',
    targetType: 'task',
    targetId: task._id,
    targetLabel: employee?.name || String(task.employee),
    summary: `Updated ${employee?.name || 'employee'}'s task for ${dateKey(task.date)}`,
    changes: diffFields(before, task, ADMIN_FIELDS),
    metadata: {
      employeeId: String(task.employee),
      employeeName: employee?.name || '',
      date: dateKey(task.date),
      task: task.assignedTask,
    },
  });

  if (employee?.status === 'active') {
    await sendTaskReviewEmail(employee, task).catch((err) => {
      console.error('[email] failed to send review email:', err);
    });
  }

  return res.json({ task });
}

async function employeeUpdateTask(req, res) {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (String(task.employee) !== String(req.user._id)) {
    return res.status(403).json({ error: 'You can only update your own task' });
  }

  // A self-added task is fully theirs to edit (except the admin verdict); a task assigned
  // by an admin is only theirs to report proof/status on.
  const fields = task.createdBy === 'employee' ? EMPLOYEE_OWN_TASK_FIELDS : EMPLOYEE_ASSIGNED_TASK_FIELDS;
  const update = pickWhitelisted(req.body, fields);
  if (!validateEnumValue(res, 'memberStatus', update.memberStatus, MEMBER_STATUSES)) return;
  Object.assign(task, update);
  await task.save();

  return res.json({ task });
}

async function deleteTask(req, res) {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const employee = isAdminLike(req.user) ? await User.findById(task.employee) : null;
  if (!isAdminLike(req.user)) {
    if (String(task.employee) !== String(req.user._id)) {
      return res.status(403).json({ error: 'You can only delete your own task' });
    }
    if (task.createdBy !== 'employee') {
      return res.status(403).json({ error: 'You cannot delete a task assigned by an admin' });
    }
  } else if (ownerOutranksAdmin(employee?.role) && !isSuperAdmin(req.user) && String(task.employee) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Only a super admin can delete another admin\'s task' });
  }

  await task.deleteOne();

  if (isAdminLike(req.user)) {
    await recordAudit({
      actor: req.user,
      action: 'task.deleted',
      targetType: 'task',
      targetId: task._id,
      targetLabel: employee?.name || String(task.employee),
      summary: `Deleted ${employee?.name || 'employee'}'s task from ${dateKey(task.date)}`,
      metadata: {
        employeeId: String(task.employee),
        employeeName: employee?.name || '',
        date: dateKey(task.date),
        task: task.assignedTask,
        createdBy: task.createdBy,
      },
    });
  }

  return res.status(204).send();
}

module.exports = {
  getToday,
  listTasks,
  createOrAssignTask,
  employeeCreateTask,
  adminUpdateTask,
  employeeUpdateTask,
  deleteTask,
};
