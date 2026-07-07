const Notification = require('../models/Notification');

/** Fans out one notification per recipient. Silently no-ops with an empty/undefined recipient list. */
async function notify(userIds, { type, message, link = '', client = null, entry = null }) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (uniqueIds.length === 0) return;

  await Notification.insertMany(
    uniqueIds.map((user) => ({ user, type, message, link, client, entry }))
  );
}

module.exports = { notify };
