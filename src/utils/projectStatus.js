function startOfTodayUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// A project due *today* still has the rest of today to be completed — it only becomes overdue
// once its end date is strictly in the past. Computed live (never stored) so it can never drift
// from reality the way a cached/cron-updated flag could.
function isProjectOverdue(project, now = new Date()) {
  return project.status !== 'completed' && new Date(project.endDate) < startOfTodayUTC(now);
}

module.exports = { startOfTodayUTC, isProjectOverdue };
