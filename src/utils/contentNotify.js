const Notification = require('../models/Notification');
const { publish } = require('./notificationBus');

/** Fans out one notification per recipient. Silently no-ops with an empty/undefined recipient list. */
async function notify(userIds, { type, message, link = '', client = null, entry = null, actor = null }) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (uniqueIds.length === 0) return;

  await Notification.insertMany(
    uniqueIds.map((user) => ({ user, type, message, link, client, entry, actor }))
  );
  uniqueIds.forEach(publish);
}

module.exports = { notify };
