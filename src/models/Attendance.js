const mongoose = require('mongoose');

const LOCATION_STATUSES = ['captured', 'denied', 'unavailable', 'unsupported', 'error'];

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The UTC instant of IST midnight for the calendar day this check-in belongs to (see
    // utils/istTime.js's startOfDayIST) — one document per employee per IST day.
    date: { type: Date, required: true },
    loginAt: { type: Date, required: true },
    lat: { type: Number },
    lng: { type: Number },
    accuracy: { type: Number },
    locationStatus: { type: String, enum: LOCATION_STATUSES, default: 'unavailable' },
  },
  { timestamps: true }
);

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
module.exports.LOCATION_STATUSES = LOCATION_STATUSES;
