const mongoose = require('mongoose');

const PROJECT_STATUSES = ['active', 'completed'];

const projectSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    brief: { type: String, trim: true, default: '' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    createdBy: { type: String, enum: ['admin', 'employee'], required: true },
    status: { type: String, enum: PROJECT_STATUSES, default: 'active' },
    // Admin-owned remark, mirrors Task.reviewerNotes — settable only through the reviewer branch
    // of updateProject, never by the owner (including an owner who is themselves an admin).
    reviewerNotes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

projectSchema.index({ employee: 1, status: 1 });
// Supports the live overdue scan (status + endDate) used by both the review-list endpoint and
// the notification builder.
projectSchema.index({ endDate: 1, status: 1 });

module.exports = mongoose.model('Project', projectSchema);
module.exports.PROJECT_STATUSES = PROJECT_STATUSES;
