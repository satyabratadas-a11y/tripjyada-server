const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const ContentEntry = require('../models/ContentEntry');

function serialize(n) {
  return {
    id: n._id,
    type: n.type,
    message: n.message,
    link: n.link,
    client: n.client,
    entry: n.entry,
    read: n.read,
    createdAt: n.createdAt,
  };
}

/** "Due soon" reminders are computed live on every fetch rather than persisted — no cron needed. */
async function buildDueSoon(userId) {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const entries = await ContentEntry.find({
    assignee: userId,
    date: { $gte: now, $lte: soon },
    status: { $nin: ['Scheduled', 'Published'] },
  })
    .select('client date format status')
    .limit(20);

  return entries.map((e) => ({
    id: `due-${e._id}`,
    type: 'due_soon',
    message: `Your ${e.format} is due ${new Date(e.date).toLocaleDateString()} and isn't scheduled yet`,
    link: `/content/${e.client}/table`,
    client: e.client,
    entry: e._id,
    read: false,
    createdAt: e.date,
  }));
}

async function listNotifications(req, res) {
  const persisted = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
  const dueSoon = await buildDueSoon(req.user._id);
  const unreadCount = persisted.filter((n) => !n.read).length + dueSoon.length;

  return res.json({
    notifications: [...dueSoon, ...persisted.map(serialize)],
    unreadCount,
  });
}

async function markRead(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Notification not found' });
  const notification = await Notification.findOne({ _id: req.params.id, user: req.user._id });
  if (!notification) return res.status(404).json({ error: 'Notification not found' });
  notification.read = true;
  await notification.save();
  return res.json({ notification: serialize(notification) });
}

async function markAllRead(req, res) {
  await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true } });
  return res.status(204).send();
}

module.exports = { listNotifications, markRead, markAllRead };
