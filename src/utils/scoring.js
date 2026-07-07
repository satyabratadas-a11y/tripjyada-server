/** Day-level and month-rollup math shared by the dashboard and report routes. */

function deriveDayType(date) {
  const d = new Date(date);
  return d.getDay() === 0 ? 'optional_sunday' : 'working';
}

function startOfMonth(year, month) {
  // month is 1-indexed (1 = January) to match query params like ?month=7&year=2026
  return new Date(Date.UTC(year, month - 1, 1));
}

function endOfMonthExclusive(year, month) {
  return new Date(Date.UTC(year, month, 1));
}

/**
 * Rolls a list of Task docs (already scoped to one employee + one month) up into
 * the same columns as the sheet's Dashboard tab.
 */
function rollupTasks(tasks) {
  let assignedDays = 0;
  let completed = 0;
  let onProgress = 0;
  let incomplete = 0;
  let flags = 0;

  for (const task of tasks) {
    if (task.dayType === 'optional_sunday' && !task.assignedTask) continue;
    assignedDays += 1;

    switch (task.adminStatus) {
      case 'completed':
        completed += 1;
        break;
      case 'on_progress':
        onProgress += 1;
        break;
      case 'flagged':
        flags += 1;
        break;
      case 'incomplete':
        incomplete += 1;
        break;
      default:
        break;
    }
  }

  const progressPct = assignedDays === 0 ? 0 : (completed + 0.5 * onProgress) / assignedDays;

  return {
    assignedDays,
    completed,
    onProgress,
    incomplete,
    flags,
    progressPct: Math.round(progressPct * 1000) / 10, // one decimal place, as a percentage number
  };
}

module.exports = {
  deriveDayType,
  startOfMonth,
  endOfMonthExclusive,
  rollupTasks,
};
