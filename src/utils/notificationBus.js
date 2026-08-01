const EventEmitter = require('events');

// In-process pub/sub: "this user just got a notification, wake up their open tab(s) now" — good
// enough for a single Node instance (this app doesn't run clustered), so no external broker
// (Redis, etc.) is needed just to push a "refresh" nudge to an open SSE connection.
const bus = new EventEmitter();
bus.setMaxListeners(0);

function publish(userId) {
  bus.emit(`user:${String(userId)}`);
}

function subscribe(userId, listener) {
  const event = `user:${String(userId)}`;
  bus.on(event, listener);
  return () => bus.off(event, listener);
}

module.exports = { publish, subscribe };
