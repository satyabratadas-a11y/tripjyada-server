const mongoose = require('mongoose');
const User = require('../models/User');
const Task = require('../models/Task');
const { startOfMonth, endOfMonthExclusive, rollupTasks } = require('../utils/scoring');
const { isAdminLike, isSuperAdmin } = require('../utils/roles');

// Mirrors the same rule task.controller.js uses for reviewing a task: an admin-or-above's own
// record requires a super admin specifically to view its trend.
function ownerOutranksAdmin(ownerRole) {
  return ownerRole === 'admin' || ownerRole === 'super_admin';
}

async function getDashboard(req, res) {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  if (!month || !year) return res.status(400).json({ error: 'month and year query params are required' });

  let members;
  if (isSuperAdmin(req.user)) {
    // Super admins review work from employees and admins, but not other super admins — that
    // tier isn't part of the reviewed hierarchy here. B2B agents do not participate in the task
    // tracker either.
    members = await User.find({ role: { $in: ['employee', 'admin'] }, status: 'active' }).sort({ name: 1 });
  } else if (isAdminLike(req.user)) {
    members = await User.find({ role: 'employee', status: 'active' }).sort({ name: 1 });
  } else {
    members = [req.user];
  }

  const rangeStart = startOfMonth(year, month);
  const rangeEnd = endOfMonthExclusive(year, month);

  // One query for the whole team instead of one per member — same result, fewer round trips as
  // the team grows.
  const memberIds = members.map((m) => m._id);
  const allTasks = await Task.find({ employee: { $in: memberIds }, date: { $gte: rangeStart, $lt: rangeEnd } });
  const tasksByEmployee = new Map();
  for (const task of allTasks) {
    const key = String(task.employee);
    if (!tasksByEmployee.has(key)) tasksByEmployee.set(key, []);
    tasksByEmployee.get(key).push(task);
  }

  const rows = members.map((member) => {
    const rollup = rollupTasks(tasksByEmployee.get(String(member._id)) || []);
    return {
      employee: { id: member._id, name: member.name, jobTitle: member.jobTitle, role: member.role },
      ...rollup,
    };
  });

  const team = rows.reduce(
    (acc, r) => {
      acc.assignedDays += r.assignedDays;
      acc.completed += r.completed;
      acc.onProgress += r.onProgress;
      acc.incomplete += r.incomplete;
      acc.flags += r.flags;
      return acc;
    },
    { assignedDays: 0, completed: 0, onProgress: 0, incomplete: 0, flags: 0 }
  );
  team.progressPct =
    team.assignedDays === 0
      ? 0
      : Math.round(((team.completed + 0.5 * team.onProgress) / team.assignedDays) * 1000) / 10;

  return res.json({ month, year, rows, team });
}

/**
 * A month-by-month progress % trend for one employee (or admin, if the caller outranks them),
 * over the last N months — for a chart, not a single-month snapshot like getDashboard.
 */
async function getTrend(req, res) {
  const { employeeId } = req.query;
  if (!employeeId || !mongoose.isValidObjectId(employeeId)) {
    return res.status(400).json({ error: 'employeeId query param must be a valid id' });
  }

  // Same visibility rule as listTasks: viewing your own trend is always fine; viewing someone
  // else's requires being admin-like, and an admin-or-above's own record requires a super admin.
  const isSelf = String(req.user._id) === String(employeeId);
  if (!isSelf && !isAdminLike(req.user)) {
    return res.status(403).json({ error: 'You can only view your own trend' });
  }

  const target = await User.findById(employeeId);
  if (!target) return res.status(404).json({ error: 'Employee not found' });
  if (!isSelf && ownerOutranksAdmin(target.role) && !isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Only a super admin can view an admin\'s trend' });
  }

  const rawMonths = parseInt(req.query.months, 10);
  const months = Number.isFinite(rawMonths) ? Math.min(Math.max(rawMonths, 1), 24) : 6;

  const now = new Date();
  const monthKeys = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  });

  const earliestStart = startOfMonth(monthKeys[0].year, monthKeys[0].month);
  const latestEnd = endOfMonthExclusive(monthKeys[monthKeys.length - 1].year, monthKeys[monthKeys.length - 1].month);
  const tasks = await Task.find({ employee: employeeId, date: { $gte: earliestStart, $lt: latestEnd } });

  const points = monthKeys.map(({ year, month }) => {
    const start = startOfMonth(year, month);
    const end = endOfMonthExclusive(year, month);
    const monthTasks = tasks.filter((t) => t.date >= start && t.date < end);
    return { year, month, ...rollupTasks(monthTasks) };
  });

  return res.json({
    employee: { id: target._id, name: target.name, jobTitle: target.jobTitle },
    points,
  });
}

module.exports = { getDashboard, getTrend };
