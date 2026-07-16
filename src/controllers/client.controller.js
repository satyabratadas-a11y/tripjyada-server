const mongoose = require('mongoose');
const Client = require('../models/Client');
const ContentPillar = require('../models/ContentPillar');
const Campaign = require('../models/Campaign');
const ContentEntry = require('../models/ContentEntry');
const ContentComment = require('../models/ContentComment');
const User = require('../models/User');
const { isAdminLike } = require('../utils/roles');

function serializeClient(client, req) {
  const effectiveRole = isAdminLike(req.user) ? 'owner' : client.roleFor(req.user._id) || 'viewer';

  return {
    id: client._id,
    name: client.name,
    brandColor: client.brandColor,
    logoUrl: client.logoUrl,
    industry: client.industry,
    businessType: client.businessType,
    description: client.description,
    status: client.status,
    // A member's `user` populates to null if that account was since deleted (e.g. by the
    // super-admin "Remove user" action) — drop those rather than crash reading off of null.
    members: client.members
      .filter((m) => m.user)
      .map((m) => ({
        user: m.user._id ? String(m.user._id) : String(m.user),
        name: m.user.name || undefined,
        email: m.user.email || undefined,
        roleInClient: m.roleInClient,
      })),
    myRole: effectiveRole,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

async function listClients(req, res) {
  const includeArchived = req.query.includeArchived === 'true';
  const filter = includeArchived ? {} : { status: 'active' };
  if (!isAdminLike(req.user) && req.user.role !== 'employee') {
    filter['members.user'] = req.user._id;
  }

  const clients = await Client.find(filter).populate('members.user', 'name email').sort({ name: 1 });
  return res.json({ clients: clients.map((c) => serializeClient(c, req)) });
}

async function createClient(req, res) {
  const { name, brandColor, industry, businessType, description } = req.body;
  const trimmedName = name?.trim();
  if (!trimmedName) return res.status(400).json({ error: 'name is required' });

  const client = await Client.create({
    name: trimmedName,
    brandColor: brandColor || '#F2701C',
    industry: industry || '',
    businessType: businessType || '',
    description: description || '',
    createdBy: req.user._id,
    members: [{ user: req.user._id, roleInClient: 'owner' }],
  });

  await client.populate('members.user', 'name email');
  return res.status(201).json({ client: serializeClient(client, req) });
}

async function getClient(req, res) {
  await req.client.populate('members.user', 'name email');
  return res.json({ client: serializeClient(req.client, req) });
}

const CLIENT_EDITOR_FIELDS = ['name', 'brandColor', 'logoUrl', 'industry', 'businessType', 'description'];
const CLIENT_OWNER_FIELDS = [...CLIENT_EDITOR_FIELDS, 'status'];

function pickWhitelisted(body, fields) {
  const update = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field];
  }
  return update;
}

async function updateClient(req, res) {
  const canManageStatus = req.isGlobalAdmin || req.clientRole === 'owner';
  const update = pickWhitelisted(req.body, canManageStatus ? CLIENT_OWNER_FIELDS : CLIENT_EDITOR_FIELDS);

  if (!canManageStatus && Object.prototype.hasOwnProperty.call(req.body, 'status')) {
    return res.status(403).json({ error: 'Only owners can archive or reactivate a calendar' });
  }
  if (update.name !== undefined && !String(update.name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (update.status && !['active', 'archived'].includes(update.status)) {
    return res.status(400).json({ error: 'status must be active or archived' });
  }
  if (update.name !== undefined) update.name = String(update.name).trim();
  Object.assign(req.client, update);
  await req.client.save();
  await req.client.populate('members.user', 'name email');
  return res.json({ client: serializeClient(req.client, req) });
}

async function deleteClient(req, res) {
  const clientId = req.client._id;
  const entries = await ContentEntry.find({ client: clientId }, '_id');
  const entryIds = entries.map((e) => e._id);
  await ContentComment.deleteMany({ entry: { $in: entryIds } });
  await ContentEntry.deleteMany({ client: clientId });
  await ContentPillar.deleteMany({ client: clientId });
  await Campaign.deleteMany({ client: clientId });
  await req.client.deleteOne();
  return res.status(204).send();
}

async function addMember(req, res) {
  const { userId, email, roleInClient } = req.body;
  if (!['owner', 'editor', 'viewer'].includes(roleInClient)) {
    return res.status(400).json({ error: 'roleInClient must be owner, editor, or viewer' });
  }
  if (!userId && !email) {
    return res.status(400).json({ error: 'userId or email is required' });
  }
  if (userId && !mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'userId must be a valid id' });
  }

  const user = userId
    ? await User.findOne({ _id: userId, status: 'active' })
    : await User.findOne({ email: String(email).trim().toLowerCase(), status: 'active' });
  if (!user) return res.status(404).json({ error: 'No active user found with that email' });

  const existing = req.client.members.find((m) => String(m.user) === String(user._id));
  if (existing) {
    existing.roleInClient = roleInClient;
  } else {
    req.client.members.push({ user: user._id, roleInClient });
  }
  await req.client.save();
  await req.client.populate('members.user', 'name email');
  return res.json({ client: serializeClient(req.client, req) });
}

async function removeMember(req, res) {
  const { userId } = req.params;
  req.client.members = req.client.members.filter((m) => String(m.user) !== String(userId));
  await req.client.save();
  await req.client.populate('members.user', 'name email');
  return res.json({ client: serializeClient(req.client, req) });
}

module.exports = {
  listClients,
  createClient,
  getClient,
  updateClient,
  deleteClient,
  addMember,
  removeMember,
};
