const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    dayType: { type: String, enum: ['working', 'optional_sunday'], required: true },
    createdBy: { type: String, enum: ['admin', 'employee'], required: true },

    // Admin-owned fields — only an admin route may write these
    assignedTask: { type: String, trim: true, default: '' },
    brief: { type: String, trim: true, default: '' },
    adminStatus: {
      type: String,
      enum: ['pending', 'completed', 'on_progress', 'incomplete', 'flagged'],
      default: 'pending',
    },
    reviewerNotes: { type: String, trim: true, default: '' },

    // Employee-owned fields — only the owning employee's route may write these
    proofLink: { type: String, trim: true, default: '' },
    memberStatus: {
      type: String,
      enum: ['not_started', 'on_progress', 'done'],
      default: 'not_started',
    },
  },
  { timestamps: true }
);

// Multiple tasks per employee per day are allowed (admin-assigned and/or self-added), so this
// index is for query performance only, not uniqueness.
taskSchema.index({ employee: 1, date: 1 });

module.exports = mongoose.model('Task', taskSchema);
