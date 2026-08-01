const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'assigned',
  'status_changed',
  'approval_requested',
  'approved',
  'rejected',
  'comment',
  'due_soon',
  'signup_pending',
  'direct',
];

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The person the notification is about/from (who assigned, commented, changed status, ...),
    // shown as a profile-picture avatar in the notification feed. Null for a notification that
    // isn't about another specific person (e.g. a due-soon reminder about the recipient's own work).
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    message: { type: String, required: true, trim: true },
    link: { type: String, trim: true, default: '' },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    entry: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentEntry', default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
// TTL index — MongoDB's background task drops a notification 30 days after it was created,
// read or not, so the collection never grows unbounded and nothing needs a cron job to prune it.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
