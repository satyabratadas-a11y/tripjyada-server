const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'token';

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    // cross-origin (client on Vercel, API on Render/Fly) requires SameSite=None,
    // which browsers only accept alongside Secure — hence tied to isProd.
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  // clearCookie must be called with matching attributes or the browser won't overwrite it.
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  });
}

module.exports = { COOKIE_NAME, signToken, setAuthCookie, clearAuthCookie };
