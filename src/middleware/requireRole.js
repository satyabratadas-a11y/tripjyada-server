const { hasRequiredRole } = require('../utils/roles');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !hasRequiredRole(req.user, allowedRoles)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = requireRole;
