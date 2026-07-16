const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { USER_ROLES } = require('../utils/roles');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    employeeCode: { type: String, trim: true, unique: true, sparse: true },
    googleId: { type: String, trim: true, default: '' },
    avatarUrl: { type: String, trim: true, default: '' },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, default: 'employee' },
    jobTitle: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['pending', 'active', 'disabled'], default: 'pending' },
    // Ephemeral notifications (task reminders, due-soon, pending signups) are computed live from
    // real state rather than stored — "mark all read" can't flip a `read` flag on them, so instead
    // it records this timestamp and anything generated at or before it counts as read.
    notificationsClearedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function setPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(plainPassword, salt);
};

userSchema.methods.comparePassword = function comparePassword(plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    phone: this.phone || '',
    employeeCode: this.employeeCode || '',
    avatarUrl: this.avatarUrl || '',
    role: this.role,
    jobTitle: this.jobTitle,
    status: this.status,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
