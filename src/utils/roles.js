const USER_ROLES = ['super_admin', 'admin', 'employee', 'b2b_agent'];

function getRole(input) {
  if (!input) return null;
  return typeof input === 'string' ? input : input.role || null;
}

function isSuperAdmin(input) {
  return getRole(input) === 'super_admin';
}

function isAdmin(input) {
  return getRole(input) === 'admin';
}

function isAdminLike(input) {
  const role = getRole(input);
  return role === 'super_admin' || role === 'admin';
}

function hasRequiredRole(input, allowedRoles = []) {
  const role = getRole(input);
  if (!role) return false;
  if (allowedRoles.includes(role)) return true;
  if (role === 'super_admin' && allowedRoles.includes('admin')) return true;
  return false;
}

module.exports = {
  USER_ROLES,
  getRole,
  isSuperAdmin,
  isAdmin,
  isAdminLike,
  hasRequiredRole,
};
