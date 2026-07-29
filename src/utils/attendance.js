const Attendance = require('../models/Attendance');
const { startOfDayIST } = require('./istTime');

/**
 * Creates today's attendance row once and optionally enriches it with browser location data.
 * Login time is immutable after the first successful insert for the IST calendar day.
 */
async function ensureTodayAttendance(employeeId, locationSet = {}) {
  const date = startOfDayIST();
  const hasLocationUpdate = Object.keys(locationSet).length > 0;
  const update = {
    $setOnInsert: { loginAt: new Date() },
    ...(hasLocationUpdate ? { $set: locationSet } : {}),
  };

  try {
    return await Attendance.findOneAndUpdate(
      { employee: employeeId, date },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // Concurrent login, session restore, and browser-location requests can race on the unique
    // employee/date index. Whichever insert wins is valid; preserve it and still apply location.
    if (error?.code !== 11000) throw error;
    if (hasLocationUpdate) {
      await Attendance.updateOne({ employee: employeeId, date }, { $set: locationSet });
    }
    return Attendance.findOne({ employee: employeeId, date });
  }
}

/**
 * Attendance must never prevent a valid user from logging in or restoring their session.
 */
async function ensureTodayAttendanceBestEffort(employeeId) {
  try {
    return await ensureTodayAttendance(employeeId);
  } catch (error) {
    console.error(`[attendance] automatic check-in failed (${error?.name || 'Error'})`);
    return null;
  }
}

module.exports = { ensureTodayAttendance, ensureTodayAttendanceBestEffort };
