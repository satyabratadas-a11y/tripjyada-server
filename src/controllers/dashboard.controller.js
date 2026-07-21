const User = require('../models/User');
const Task = require('../models/Task');
const { startOfMonth, endOfMonthExclusive, rollupTasks } = require('../utils/scoring');
const { isAdminLike, isSuperAdmin } = require('../utils/roles');

async function getDashboard(req, res) {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  if (!month || !year) return res.status(400).json({ error: 'month and year query params are required' });

  let members;
  if (isSuperAdmin(req.user)) {
    // Super admins review work from every task-owning role, including other admins and their
    // own self-added tasks. B2B agents do not participate in the task tracker.
    members = await User.find({ role: { $in: ['employee', 'admin', 'super_admin'] }, status: 'active' }).sort({ name: 1 });
  } else if (isAdminLike(req.user)) {
    members = await User.find({ role: 'employee', status: 'active' }).sort({ name: 1 });
  } else {
    members = [req.user];
  }

  const rangeStart = startOfMonth(year, month);
  const rangeEnd = endOfMonthExclusive(year, month);

  const rows = await Promise.all(
    members.map(async (member) => {
      const tasks = await Task.find({ employee: member._id, date: { $gte: rangeStart, $lt: rangeEnd } });
      const rollup = rollupTasks(tasks);
      return {
        employee: { id: member._id, name: member.name, jobTitle: member.jobTitle, role: member.role },
        ...rollup,
      };
    })
  );

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

module.exports = { getDashboard };
