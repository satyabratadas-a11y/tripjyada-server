const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { startOfDayIST } = require('../utils/istTime');
const { isSuperAdmin } = require('../utils/roles');

/**
 * Records today's first login for the caller and, if the browser provided one, a location
 * snapshot from that moment. Safe to call more than once a day (the client does, once per tab
 * load) — loginAt is only ever set on the IST day's first call via $setOnInsert; a later call
 * can still fill in location if the first attempt had none yet (e.g. the permission prompt was
 * still pending on that call).
 */
async function checkIn(req, res) {
  const { lat, lng, accuracy, status } = req.body;
  if (status !== undefined && !Attendance.LOCATION_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${Attendance.LOCATION_STATUSES.join(', ')}` });
  }

  const hasCoords = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);

  const locationSet = {};
  if (hasCoords) {
    locationSet.lat = lat;
    locationSet.lng = lng;
    if (typeof accuracy === 'number' && Number.isFinite(accuracy)) locationSet.accuracy = accuracy;
    locationSet.locationStatus = 'captured';
  } else if (status) {
    locationSet.locationStatus = status;
  }

  const attendance = await Attendance.findOneAndUpdate(
    { employee: req.user._id, date: startOfDayIST() },
    {
      $setOnInsert: { loginAt: new Date() },
      ...(Object.keys(locationSet).length ? { $set: locationSet } : {}),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return res.status(200).json({ attendance });
}

/**
 * Admin-only: today's login/location status for every visible employee, including anyone who
 * hasn't checked in at all today — the roster comes from User, not Attendance, so a missing
 * check-in is a visible "not logged in" row instead of silently absent. Visibility mirrors the
 * dashboard: a plain admin sees employees only, a super admin also sees other admins.
 */
async function listToday(req, res) {
  const visibleRoles = isSuperAdmin(req.user) ? ['employee', 'admin'] : ['employee'];
  const employees = await User.find({ role: { $in: visibleRoles }, status: 'active' })
    .select('name jobTitle role')
    .sort({ name: 1 });

  const today = startOfDayIST();
  const records = await Attendance.find({ employee: { $in: employees.map((e) => e._id) }, date: today });
  const byEmployee = new Map(records.map((r) => [String(r.employee), r]));

  const rows = employees.map((e) => {
    const record = byEmployee.get(String(e._id));
    return {
      employee: { id: e._id, name: e.name, jobTitle: e.jobTitle, role: e.role },
      checkedIn: Boolean(record),
      loginAt: record?.loginAt || null,
      lat: record?.lat ?? null,
      lng: record?.lng ?? null,
      accuracy: record?.accuracy ?? null,
      locationStatus: record?.locationStatus || null,
    };
  });

  return res.json({ date: today, rows });
}

module.exports = { checkIn, listToday };
