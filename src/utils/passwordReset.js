const crypto = require('crypto');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function createResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  return { token, tokenHash, expiresAt };
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// A single Node process on Hostinger, not a distributed deploy, so an in-memory counter is
// enough to blunt inbox-spam / email-enumeration abuse without adding a Redis dependency for
// one endpoint.
const attempts = new Map();

function isRateLimited(key, { max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

module.exports = { createResetToken, hashResetToken, isRateLimited };
