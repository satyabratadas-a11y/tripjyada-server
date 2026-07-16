const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'token';
// The cookie's maxAge is kept in lockstep with the JWT's own expiry — if the cookie outlived the
// token, the browser would keep sending an expired token; if the token outlived the cookie, a
// valid session would vanish client-side before it actually expired.
const SESSION_MS = 24 * 60 * 60 * 1000;

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
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
    maxAge: SESSION_MS,
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
