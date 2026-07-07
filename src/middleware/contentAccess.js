const mongoose = require('mongoose');
const Client = require('../models/Client');

/**
 * Loads :clientId, and grants access to global admins or client members.
 * Attaches req.client, req.isGlobalAdmin, and req.clientRole (the caller's
 * roleInClient — null for admins acting outside the members list, since
 * requireClientRole below always lets admins through regardless).
 */
async function requireClientAccess(req, res, next) {
  const { clientId } = req.params;
  if (!mongoose.isValidObjectId(clientId)) {
    return res.status(400).json({ error: 'clientId must be a valid id' });
  }

  const client = await Client.findById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const isGlobalAdmin = req.user.role === 'admin';
  const clientRole = client.roleFor(req.user._id);

  if (!isGlobalAdmin && !clientRole) {
    return res.status(403).json({ error: 'You do not have access to this client' });
  }

  req.client = client;
  req.isGlobalAdmin = isGlobalAdmin;
  req.clientRole = clientRole;
  next();
}

/** Must run after requireClientAccess. Global admins always pass. */
function requireClientRole(...allowedRoles) {
  return (req, res, next) => {
    if (req.isGlobalAdmin) return next();
    if (req.clientRole && allowedRoles.includes(req.clientRole)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = { requireClientAccess, requireClientRole };
