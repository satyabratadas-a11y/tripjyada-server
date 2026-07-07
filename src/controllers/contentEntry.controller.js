const ContentEntry = require('../models/ContentEntry');
const ContentComment = require('../models/ContentComment');
const { notify } = require('../utils/contentNotify');
const { isUploadEnabled, uploadBuffer, destroyAsset } = require('../utils/cloudinary');
const { buildCSV, buildExcelBuffer, buildPDF } = require('../utils/exportContent');

const { CONTENT_FORMATS, PLATFORMS, CONTENT_STATUSES, APPROVAL_STATUSES } = ContentEntry;

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function validateEnumValue(res, field, value, allowed) {
  if (value !== undefined && !allowed.includes(value)) {
    res.status(400).json({ error: `${field} must be one of: ${allowed.join(', ')}` });
    return false;
  }
  return true;
}

function pickWhitelisted(body, fields) {
  const update = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field];
  }
  return update;
}

async function populateEntry(doc) {
  return doc.populate([
    { path: 'pillar', select: 'name color' },
    { path: 'campaign', select: 'name color' },
    { path: 'assignee', select: 'name' },
    { path: 'createdBy', select: 'name' },
  ]);
}

function serializeEntry(e) {
  return {
    id: e._id,
    client: e.client,
    date: e.date,
    time: e.time,
    format: e.format,
    pillar: e.pillar && e.pillar._id ? { id: e.pillar._id, name: e.pillar.name, color: e.pillar.color } : e.pillar,
    campaign: e.campaign && e.campaign._id ? { id: e.campaign._id, name: e.campaign.name, color: e.campaign.color } : e.campaign,
    idea: e.idea,
    hook: e.hook,
    caption: e.caption,
    cta: e.cta,
    platform: e.platform,
    assignee: e.assignee && e.assignee._id ? { id: e.assignee._id, name: e.assignee.name } : e.assignee,
    status: e.status,
    approvalStatus: e.approvalStatus,
    reviewNote: e.reviewNote,
    attachments: e.attachments.map((a) => ({
      id: a._id,
      url: a.url,
      resourceType: a.resourceType,
      name: a.name,
      uploadedAt: a.uploadedAt,
    })),
    order: e.order,
    history: e.history,
    createdBy: e.createdBy && e.createdBy._id ? { id: e.createdBy._id, name: e.createdBy.name } : e.createdBy,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function parseListParam(value) {
  if (!value) return undefined;
  return Array.isArray(value) ? value : String(value).split(',').filter(Boolean);
}

function buildEntryFilter(req) {
  const { from, to, pillar, campaign, assignee, q } = req.query;
  const statusList = parseListParam(req.query.status);
  const platformList = parseListParam(req.query.platform);

  let start;
  let end;
  if (from || to) {
    start = from ? new Date(from) : new Date(0);
    if (to) {
      end = new Date(to);
      end.setUTCDate(end.getUTCDate() + 1);
    } else {
      end = new Date(8640000000000000);
    }
  } else {
    const now = new Date();
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }

  const filter = { client: req.client._id, date: { $gte: start, $lt: end } };
  if (statusList) filter.status = { $in: statusList };
  if (platformList) filter.platform = { $in: platformList };
  if (pillar) filter.pillar = pillar;
  if (campaign) filter.campaign = campaign;
  if (assignee) filter.assignee = assignee;
  if (q) {
    const regex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ idea: regex }, { hook: regex }, { caption: regex }, { cta: regex }];
  }
  return filter;
}

async function listEntries(req, res) {
  const entries = await ContentEntry.find(buildEntryFilter(req))
    .populate('pillar', 'name color')
    .populate('campaign', 'name color')
    .populate('assignee', 'name')
    .populate('createdBy', 'name')
    .sort({ date: 1, order: 1, createdAt: 1 });

  return res.json({ entries: entries.map(serializeEntry) });
}

async function getEntry(req, res) {
  const entry = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id });
  if (!entry) return res.status(404).json({ error: 'Content entry not found' });
  await populateEntry(entry);
  return res.json({ entry: serializeEntry(entry) });
}

async function createEntry(req, res) {
  const { date, time, format, pillar, campaign, idea, hook, caption, cta, platform, assignee, status, approvalStatus } =
    req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });
  if (!validateEnumValue(res, 'format', format, CONTENT_FORMATS)) return;
  if (!validateEnumValue(res, 'platform', platform, PLATFORMS)) return;
  if (!validateEnumValue(res, 'status', status, CONTENT_STATUSES)) return;
  if (!validateEnumValue(res, 'approvalStatus', approvalStatus, APPROVAL_STATUSES)) return;

  const entry = await ContentEntry.create({
    client: req.client._id,
    date: new Date(date),
    time: time || '',
    format: format || 'Creative',
    pillar: pillar || null,
    campaign: campaign || null,
    idea: idea || '',
    hook: hook || '',
    caption: caption || '',
    cta: cta || '',
    platform: platform || 'Instagram',
    assignee: assignee || null,
    status: status || 'Idea',
    approvalStatus: approvalStatus || 'Pending',
    createdBy: req.user._id,
  });

  if (assignee && String(assignee) !== String(req.user._id)) {
    await notify([assignee], {
      type: 'assigned',
      message: `You were assigned a new ${entry.format} for ${dateKey(entry.date)}`,
      link: `/content/${req.client._id}/table`,
      client: req.client._id,
      entry: entry._id,
    });
  }

  await populateEntry(entry);
  return res.status(201).json({ entry: serializeEntry(entry) });
}

const ENTRY_FIELDS = ['date', 'time', 'format', 'pillar', 'campaign', 'idea', 'hook', 'caption', 'cta', 'platform', 'assignee', 'status'];

async function updateEntry(req, res) {
  const entry = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id });
  if (!entry) return res.status(404).json({ error: 'Content entry not found' });

  const update = pickWhitelisted(req.body, ENTRY_FIELDS);
  if (!validateEnumValue(res, 'format', update.format, CONTENT_FORMATS)) return;
  if (!validateEnumValue(res, 'platform', update.platform, PLATFORMS)) return;
  if (!validateEnumValue(res, 'status', update.status, CONTENT_STATUSES)) return;
  if (update.date) update.date = new Date(update.date);

  const before = {};
  for (const field of Object.keys(update)) before[field] = entry[field];
  const previousAssignee = entry.assignee ? String(entry.assignee) : null;
  const previousStatus = entry.status;

  Object.assign(entry, update);

  for (const field of Object.keys(update)) {
    const beforeVal = before[field] === undefined || before[field] === null ? null : String(before[field]);
    const afterVal = entry[field] === undefined || entry[field] === null ? null : String(entry[field]);
    if (beforeVal !== afterVal) {
      entry.history.push({ field, before: beforeVal, after: afterVal, changedBy: req.user._id });
    }
  }
  await entry.save();

  if (update.assignee !== undefined) {
    const newAssignee = entry.assignee ? String(entry.assignee) : null;
    if (newAssignee && newAssignee !== previousAssignee) {
      await notify([newAssignee], {
        type: 'assigned',
        message: `You were assigned a ${entry.format} for ${dateKey(entry.date)}`,
        link: `/content/${req.client._id}/table`,
        client: req.client._id,
        entry: entry._id,
      });
    }
  }

  if (update.status && update.status !== previousStatus) {
    if (update.status === 'Review') {
      const ownerIds = req.client.members.filter((m) => m.roleInClient === 'owner').map((m) => m.user);
      await notify(ownerIds, {
        type: 'approval_requested',
        message: `A ${entry.format} for ${dateKey(entry.date)} was submitted for review`,
        link: `/content/${req.client._id}/table`,
        client: req.client._id,
        entry: entry._id,
      });
    } else {
      const recipients = [entry.assignee, entry.createdBy].filter(Boolean).map(String);
      await notify(recipients, {
        type: 'status_changed',
        message: `Status changed to "${update.status}" for your ${entry.format} on ${dateKey(entry.date)}`,
        link: `/content/${req.client._id}/table`,
        client: req.client._id,
        entry: entry._id,
      });
    }
  }

  await populateEntry(entry);
  return res.json({ entry: serializeEntry(entry) });
}

async function setApproval(req, res) {
  const entry = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id });
  if (!entry) return res.status(404).json({ error: 'Content entry not found' });

  const { approvalStatus, reviewNote } = req.body;
  if (!approvalStatus) return res.status(400).json({ error: 'approvalStatus is required' });
  if (!validateEnumValue(res, 'approvalStatus', approvalStatus, APPROVAL_STATUSES)) return;

  const before = { approvalStatus: entry.approvalStatus, status: entry.status };
  entry.approvalStatus = approvalStatus;
  entry.reviewNote = reviewNote || '';

  if (approvalStatus === 'Approved') {
    entry.status = 'Approved';
  } else if (approvalStatus === 'Rejected' || approvalStatus === 'Changes Requested') {
    entry.status = 'Draft';
  }

  entry.history.push({ field: 'approvalStatus', before: before.approvalStatus, after: entry.approvalStatus, changedBy: req.user._id });
  if (before.status !== entry.status) {
    entry.history.push({ field: 'status', before: before.status, after: entry.status, changedBy: req.user._id });
  }
  await entry.save();

  const recipients = [entry.assignee, entry.createdBy].filter(Boolean).map(String);
  await notify(recipients, {
    type: approvalStatus === 'Approved' ? 'approved' : 'rejected',
    message: `Your ${entry.format} for ${dateKey(entry.date)} was ${approvalStatus.toLowerCase()}${reviewNote ? `: ${reviewNote}` : ''}`,
    link: `/content/${req.client._id}/table`,
    client: req.client._id,
    entry: entry._id,
  });

  await populateEntry(entry);
  return res.json({ entry: serializeEntry(entry) });
}

async function moveEntry(req, res) {
  const entry = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id });
  if (!entry) return res.status(404).json({ error: 'Content entry not found' });

  const { date, order } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const beforeDate = entry.date;
  entry.date = new Date(date);
  if (order !== undefined) entry.order = order;
  if (dateKey(beforeDate) !== dateKey(entry.date)) {
    entry.history.push({ field: 'date', before: dateKey(beforeDate), after: dateKey(entry.date), changedBy: req.user._id });
  }
  await entry.save();

  await populateEntry(entry);
  return res.json({ entry: serializeEntry(entry) });
}

async function duplicateEntry(req, res) {
  const source = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id });
  if (!source) return res.status(404).json({ error: 'Content entry not found' });

  const targetDate = req.body?.date ? new Date(req.body.date) : source.date;

  const clone = await ContentEntry.create({
    client: req.client._id,
    date: targetDate,
    time: source.time,
    format: source.format,
    pillar: source.pillar,
    campaign: source.campaign,
    idea: source.idea,
    hook: source.hook,
    caption: source.caption,
    cta: source.cta,
    platform: source.platform,
    assignee: source.assignee,
    status: 'Idea',
    approvalStatus: 'Pending',
    createdBy: req.user._id,
  });

  await populateEntry(clone);
  return res.status(201).json({ entry: serializeEntry(clone) });
}

async function deleteEntry(req, res) {
  const entry = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id });
  if (!entry) return res.status(404).json({ error: 'Content entry not found' });
  await ContentComment.deleteMany({ entry: entry._id });
  await entry.deleteOne();
  return res.status(204).send();
}

async function bulkCreate(req, res) {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries must be a non-empty array' });
  }
  if (entries.length > 200) {
    return res.status(400).json({ error: 'Cannot create more than 200 entries at once' });
  }

  const docs = [];
  for (let i = 0; i < entries.length; i += 1) {
    const raw = entries[i];
    if (!raw.date) return res.status(400).json({ error: `entries[${i}].date is required` });
    if (!validateEnumValue(res, `entries[${i}].format`, raw.format, CONTENT_FORMATS)) return;
    if (!validateEnumValue(res, `entries[${i}].platform`, raw.platform, PLATFORMS)) return;
    docs.push({
      client: req.client._id,
      date: new Date(raw.date),
      time: raw.time || '',
      format: raw.format || 'Creative',
      pillar: raw.pillar || null,
      campaign: raw.campaign || null,
      idea: raw.idea || '',
      hook: raw.hook || '',
      caption: raw.caption || '',
      cta: raw.cta || '',
      platform: raw.platform || 'Instagram',
      assignee: raw.assignee || null,
      status: 'Idea',
      approvalStatus: 'Pending',
      createdBy: req.user._id,
    });
  }

  const created = await ContentEntry.insertMany(docs);
  const populated = await ContentEntry.find({ _id: { $in: created.map((c) => c._id) } })
    .populate('pillar', 'name color')
    .populate('campaign', 'name color')
    .populate('assignee', 'name')
    .populate('createdBy', 'name');

  return res.status(201).json({ entries: populated.map(serializeEntry) });
}

async function bulkUpdate(req, res) {
  const { ids, update: rawUpdate } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array' });

  const update = pickWhitelisted(rawUpdate || {}, ['status', 'assignee', 'date', 'pillar', 'campaign', 'platform']);
  if (!validateEnumValue(res, 'status', update.status, CONTENT_STATUSES)) return;
  if (!validateEnumValue(res, 'platform', update.platform, PLATFORMS)) return;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  if (update.date) update.date = new Date(update.date);

  await ContentEntry.updateMany(
    { _id: { $in: ids }, client: req.client._id },
    {
      $set: update,
      $push: { history: { field: 'bulk_update', before: null, after: JSON.stringify(update), changedBy: req.user._id } },
    }
  );

  const entries = await ContentEntry.find({ _id: { $in: ids }, client: req.client._id })
    .populate('pillar', 'name color')
    .populate('campaign', 'name color')
    .populate('assignee', 'name')
    .populate('createdBy', 'name');
  return res.json({ entries: entries.map(serializeEntry) });
}

async function bulkDelete(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array' });
  await ContentComment.deleteMany({ entry: { $in: ids } });
  await ContentEntry.deleteMany({ _id: { $in: ids }, client: req.client._id });
  return res.status(204).send();
}

async function uploadAttachment(req, res) {
  if (!isUploadEnabled()) {
    return res.status(503).json({ error: 'File uploads are not configured. Add CLOUDINARY_* keys to server/.env to enable them.' });
  }
  const entry = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id });
  if (!entry) return res.status(404).json({ error: 'Content entry not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const resourceType = req.file.mimetype.startsWith('video') ? 'video' : req.file.mimetype.startsWith('image') ? 'image' : 'raw';
  const result = await uploadBuffer(req.file.buffer, { folder: `content-calendar/${req.client._id}`, resourceType });

  entry.attachments.push({
    url: result.secure_url,
    publicId: result.public_id,
    resourceType,
    name: req.file.originalname,
    uploadedBy: req.user._id,
  });
  await entry.save();
  await populateEntry(entry);
  return res.status(201).json({ entry: serializeEntry(entry) });
}

async function deleteAttachment(req, res) {
  const entry = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id });
  if (!entry) return res.status(404).json({ error: 'Content entry not found' });
  const attachment = entry.attachments.id(req.params.attachmentId);
  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

  if (isUploadEnabled() && attachment.publicId) {
    await destroyAsset(attachment.publicId, attachment.resourceType).catch((err) => {
      console.error('[cloudinary] failed to delete asset:', err);
    });
  }
  attachment.deleteOne();
  await entry.save();
  await populateEntry(entry);
  return res.json({ entry: serializeEntry(entry) });
}

function serializeComment(c) {
  return {
    id: c._id,
    entry: c.entry,
    author: c.author && c.author._id ? { id: c.author._id, name: c.author.name } : c.author,
    text: c.text,
    createdAt: c.createdAt,
  };
}

async function listComments(req, res) {
  const entry = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id }, '_id');
  if (!entry) return res.status(404).json({ error: 'Content entry not found' });
  const comments = await ContentComment.find({ entry: entry._id }).populate('author', 'name').sort({ createdAt: 1 });
  return res.json({ comments: comments.map(serializeComment) });
}

async function addComment(req, res) {
  const entry = await ContentEntry.findOne({ _id: req.params.id, client: req.client._id });
  if (!entry) return res.status(404).json({ error: 'Content entry not found' });
  const text = req.body.text?.trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  const comment = await ContentComment.create({ entry: entry._id, author: req.user._id, text });
  await comment.populate('author', 'name');

  const priorCommenters = await ContentComment.find({ entry: entry._id }).distinct('author');
  const recipients = [entry.assignee, entry.createdBy, ...priorCommenters]
    .filter(Boolean)
    .map(String)
    .filter((id) => id !== String(req.user._id));

  await notify(recipients, {
    type: 'comment',
    message: `${req.user.name} commented on a ${entry.format} for ${dateKey(entry.date)}`,
    link: `/content/${req.client._id}/table`,
    client: req.client._id,
    entry: entry._id,
  });

  return res.status(201).json({ comment: serializeComment(comment) });
}

async function deleteComment(req, res) {
  const comment = await ContentComment.findById(req.params.commentId).populate('entry', 'client');
  if (!comment || !comment.entry || String(comment.entry.client) !== String(req.client._id)) {
    return res.status(404).json({ error: 'Comment not found' });
  }
  if (!req.isGlobalAdmin && String(comment.author) !== String(req.user._id)) {
    return res.status(403).json({ error: 'You can only delete your own comment' });
  }
  await comment.deleteOne();
  return res.status(204).send();
}

async function exportEntries(req, res) {
  const format = String(req.query.format || 'csv').toLowerCase();
  const entries = await ContentEntry.find(buildEntryFilter(req))
    .populate('pillar', 'name')
    .populate('campaign', 'name')
    .populate('assignee', 'name')
    .sort({ date: 1, order: 1 });

  const filenameBase = `content-calendar-${req.client.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

  if (format === 'xlsx') {
    const buffer = await buildExcelBuffer(entries, req.client.name);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buffer);
  }

  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
    return buildPDF(res, entries, `Content Calendar — ${req.client.name}`);
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
  return res.send(buildCSV(entries));
}

module.exports = {
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  setApproval,
  moveEntry,
  duplicateEntry,
  deleteEntry,
  bulkCreate,
  bulkUpdate,
  bulkDelete,
  uploadAttachment,
  deleteAttachment,
  listComments,
  addComment,
  deleteComment,
  exportEntries,
};
