// India has no DST, so IST is safely a fixed UTC+5:30 offset — no timezone database needed.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Shifts a UTC instant by the IST offset so its UTC-getter methods (getUTCHours, getUTCDay, ...)
// read like IST wall-clock values, without needing a timezone library.
function istWallClock(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

// The UTC instant of IST midnight for `date`'s IST calendar day — the IST analogue of
// projectStatus.js's startOfTodayUTC, used as the day boundary for reminders/attendance so they
// line up with the team's actual morning instead of the server's UTC day.
function startOfDayIST(date = new Date()) {
  const ist = istWallClock(date);
  const istMidnightUTC = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(istMidnightUTC - IST_OFFSET_MS);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isSundayIST(date = new Date()) {
  return istWallClock(date).getUTCDay() === 0;
}

function minutesSinceMidnightIST(date = new Date()) {
  const ist = istWallClock(date);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

module.exports = { IST_OFFSET_MS, startOfDayIST, addDays, isSundayIST, minutesSinceMidnightIST };
