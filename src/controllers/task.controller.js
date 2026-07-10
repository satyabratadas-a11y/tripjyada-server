const mongoose = require('mongoose');
const Task = require('../models/Task');
const User = require('../models/User');
const { deriveDayType, startOfMonth, endOfMonthExclusive } = require('../utils/scoring');
const { diffFields, recordAudit } = require('../utils/audit');
const { sendTaskAssignedEmail, sendTaskReviewEmail } = require('../utils/email');
const { isAdminLike } = require('../utils/roles');

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
 */
async function getToday(req, res) {
  const { start, end } = dayRangeUTC(req.query.date);

  let employees;
  if (isAdminLike(req.user)) {
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

/** Admin can request any employeeId; an employee is always forced to their own id. */
async function listTasks(req, res) {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  if (!month || !year) return res.status(400).json({ error: 'month and year query params are required' });

  let employeeId;
  if (isAdminLike(req.user)) {
    employeeId = req.query.employeeId;
    if (!employeeId || !mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({ error: 'employeeId query param must be a valid id' });
    }
  } else {
    employeeId = String(req.user._id);
  }

  const tasks = await Task.find({
    employee: employeeId,
    date: { $gte: startOfMonth(year, month), $lt: endOfMonthExclusive(year, month) },
  }).sort({ date: 1, createdAt: 1 });

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

  const employee = await User.findById(task.employee);
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
