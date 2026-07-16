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
const MEMBER_STATUSES = ['not_started', 'on_progress', 'done'];

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
 */
async function getToday(req, res) {
  const { start, end } = dayRangeUTC(req.query.date);
  const ownOnly = req.query.scope === 'own';

  let employees;
  if (isAdminLike(req.user) && !ownOnly) {
    employees = await User.find({ role: 'employee', status: 'active' }).sort({ name: 1 });
  } else {
    employees = [req.user];
  }

  const tasks = await Task.find({
    employee: { $in: employees.map((e) => e._id) },
    date: { $gte: start, $lt: end },
  }).sort({ createdAt: 1 });

  const tasksByEmployee = new Map();
  for (const t of tasks) {
    const key = String(t.employee);
    if (!tasksByEmployee.has(key)) tasksByEmployee.set(key, []);
    tasksByEmployee.get(key).push(t);
  }

  const rows = employees.map((emp) => ({
    employee: { id: emp._id, name: emp.name, jobTitle: emp.jobTitle },
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

  // The monthly log is the permanent record, not a work-in-progress tracker — a task only earns
  // its place here once the owner has actually marked it done, whether they self-added it or an
  // admin assigned it. The live "Today" view (getToday) is unaffected and still shows everything.
  // A super admin's monthly oversight view opts back into everything via ?allStatuses=true, since
  // spotting flagged/in-progress work across the team is exactly what that view is for.
  const filter = {
    employee: employeeId,
    date: { $gte: startOfMonth(year, month), $lt: endOfMonthExclusive(year, month) },
  };
  if (!(req.query.allStatuses === 'true' && isSuperAdmin(req.user))) {
    filter.memberStatus = 'done';
  }

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

/** Employee-only: adds a task for themselves. They own every field on tasks they create. */
async function employeeCreateTask(req, res) {
  const { date, assignedTask, brief, proofLink, memberStatus } = req.body;
  const trimmedAssignedTask = assignedTask?.trim();
  if (!date || !trimmedAssignedTask) {
    return res.status(400).json({ error: 'date and assignedTask are required' });
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
