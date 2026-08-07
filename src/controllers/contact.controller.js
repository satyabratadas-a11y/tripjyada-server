const ExcelJS = require('exceljs');
const Contact = require('../models/Contact');
const User = require('../models/User');
const { isSuperAdmin } = require('../utils/roles');
const { extractCardFields, testConnection } = require('../utils/gemini');
const { recordAudit } = require('../utils/audit');
const { appendContactRow } = require('../utils/googleSheets');

const CONTACT_FIELDS = [
  'name',
  'company',
  'jobTitle',
  'phone',
  'email',
  'website',
  'address',
  'state',
  'pincode',
  'notes',
  'rawOcrText',
];

// Required for every contact regardless of how it was captured (scan, bulk, or manual) — this is
// the field set Mailer Cloud's bulk-import needs populated to be usable for email marketing later.
const MANDATORY_FIELDS = ['company', 'email', 'phone', 'address', 'state', 'pincode'];
const MANDATORY_FIELD_LABELS = {
  company: 'business name',
  email: 'email',
  phone: 'phone number',
  address: 'address',
  state: 'state',
  pincode: 'pincode',
};

// Contacts are one shared pool across every B2B agent, not per-agent silos — so "is this a
// duplicate" has to check everyone's captures, not just the current agent's own. The scanner (and
// manual entry) can pack multiple "/"-separated numbers/emails from one card into a single field
// (see utils/gemini.js), and OCR/formatting varies (+91 prefixes, spacing), so matching compares
// normalized individual values rather than the raw strings.
function normalizedPhones(phoneField) {
  if (!phoneField) return [];
  return phoneField
    .split('/')
    .map((p) => p.replace(/\D/g, ''))
    .map((digits) => digits.slice(-10))
    .filter((digits) => digits.length >= 7);
}

// Strips the +91 country code (or any other prefix digits beyond the last 10) so only the bare
// 10-digit number is ever stored — applied on scan review and again on save, so it holds no
// matter whether the number came from the OCR, a manual edit, or manual entry from scratch.
function cleanPhoneField(phoneField) {
  return normalizedPhones(phoneField).join(' / ');
}

function normalizedEmails(emailField) {
  if (!emailField) return [];
  return emailField
    .split('/')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Shared between the paginated list and the Excel export, so "download" always matches whatever
// the agent/date/search filters currently show on screen rather than silently exporting everyone.
function buildContactFilter({ agentId, q, date }) {
  const filter = {};
  if (agentId) filter.capturedBy = agentId;
  if (q) {
    const re = new RegExp(escapeRegex(String(q).trim()), 'i');
    filter.$or = [{ name: re }, { company: re }, { phone: re }, { email: re }, { address: re }];
  }
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isNaN(start.getTime())) {
      filter.createdAt = { $gte: start, $lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
    }
  }
  return filter;
}

function serializeDuplicate(contact) {
  return {
    id: contact._id,
    name: contact.name,
    company: contact.company,
    capturedBy: contact.capturedBy?.name || '',
    createdAt: contact.createdAt,
  };
}

async function findDuplicateContact({ phone, email, excludeId }) {
  const phones = normalizedPhones(phone);
  const emails = normalizedEmails(email);
  if (phones.length === 0 && emails.length === 0) return null;

  const query = { $or: [{ phone: { $nin: ['', null] } }, { email: { $nin: ['', null] } }] };
  if (excludeId) query._id = { $ne: excludeId };

  const candidates = await Contact.find(query)
    .select('name company phone email capturedBy createdAt')
    .populate('capturedBy', 'name');

  return (
    candidates.find((c) => {
      const cPhones = normalizedPhones(c.phone);
      const cEmails = normalizedEmails(c.email);
      return phones.some((p) => cPhones.includes(p)) || emails.some((e) => cEmails.includes(e));
    }) || null
  );
}

async function scanCard(req, res) {
  const requestStartedAt = Date.now();
  const frontFile = req.files?.image?.[0];
  const backFile = req.files?.backImage?.[0];
  if (!frontFile) return res.status(400).json({ error: 'No card image uploaded' });

  // Time from when Express finished receiving the (already-parsed) upload to now is ~0 — the real
  // upload transfer time happens before this handler even runs, so it isn't visible here. This
  // marks how long the Gemini round trip itself takes, which is the part actually in our control.
  const images = [{ buffer: frontFile.buffer, mimeType: frontFile.mimetype }];
  if (backFile) images.push({ buffer: backFile.buffer, mimeType: backFile.mimetype });

  const fields = await extractCardFields(images);
  fields.phone = cleanPhoneField(fields.phone);
  const duplicate = await findDuplicateContact({ phone: fields.phone, email: fields.email });
  console.log(`[scanCard] request handled in ${Date.now() - requestStartedAt}ms`);
  return res.json({ fields, duplicate: duplicate ? serializeDuplicate(duplicate) : null });
}

function pickContactFields(body) {
  const picked = {};
  for (const field of CONTACT_FIELDS) {
    if (typeof body[field] === 'string') picked[field] = body[field];
  }
  return picked;
}

async function createContact(req, res) {
  const frontFile = req.files?.image?.[0];
  const backFile = req.files?.backImage?.[0];
  const fields = pickContactFields(req.body);
  if (fields.phone) fields.phone = cleanPhoneField(fields.phone);

  const missing = MANDATORY_FIELDS.filter((field) => !fields[field]?.trim());
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Enter the ${missing.map((field) => MANDATORY_FIELD_LABELS[field]).join(', ')} before saving.`,
    });
  }

  const duplicate = await findDuplicateContact({ phone: fields.phone, email: fields.email });
  if (duplicate) {
    return res.status(409).json({
      error: `Already saved — matches ${duplicate.name || duplicate.company || 'a contact'} captured by ${
        duplicate.capturedBy?.name || 'someone'
      } on ${new Date(duplicate.createdAt).toLocaleDateString()}.`,
      duplicate: serializeDuplicate(duplicate),
    });
  }

  const imageUrl = frontFile ? `data:${frontFile.mimetype};base64,${frontFile.buffer.toString('base64')}` : '';
  const backImageUrl = backFile ? `data:${backFile.mimetype};base64,${backFile.buffer.toString('base64')}` : '';

  const contact = await Contact.create({
    ...fields,
    capturedBy: req.user._id,
    imageUrl,
    backImageUrl,
  });

  // Fire-and-forget, same as the assignment/review emails elsewhere — a Sheets hiccup shouldn't
  // fail the save, and it silently no-ops entirely until GOOGLE_SHEETS_ID etc. are configured.
  appendContactRow({ contact, agentName: req.user.name }).catch((err) => {
    console.error('[sheets] failed to append contact row:', err.message);
  });

  return res.status(201).json({ contact });
}

// Contacts are one shared pool across every B2B agent (see findDuplicateContact above) — so this
// export mirrors that: every agent and the super admin download the same full list, not a
// per-agent subset.
async function exportContacts(req, res) {
  const { agentId, q, date } = req.query;
  const contacts = await Contact.find(buildContactFilter({ agentId, q, date }))
    .select('name company phone email address state pincode capturedBy createdAt')
    .sort({ createdAt: -1 })
    .populate('capturedBy', 'name');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Task Tracker';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('B2B Contacts');
  const header = sheet.addRow(['Date', 'Name', 'Company', 'Phone', 'Email', 'Address', 'State', 'Pincode', 'Captured By']);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  });

  for (const c of contacts) {
    sheet.addRow([
      c.createdAt.toISOString().slice(0, 10),
      c.name,
      c.company,
      c.phone,
      c.email,
      c.address,
      c.state,
      c.pincode,
      c.capturedBy?.name || '',
    ]);
  }

  sheet.columns.forEach((col) => {
    col.width = 24;
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="b2b-contacts-${new Date().toISOString().slice(0, 10)}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}

const LIST_PAGE_SIZE = 25;
const LIST_PAGE_SIZE_MAX = 100;
// Excludes imageUrl/backImageUrl/rawOcrText — the base64 card photos are the bulk of a Contact
// document's size (see Contact model), and shipping every row's photos on every list page is what
// made this endpoint balloon into minutes-long, timing-out responses as the shared pool grew. The
// detail modal fetches the full record (photos included) on demand via GET /:id instead.
const LIST_FIELDS = 'name company jobTitle phone email address state pincode capturedBy createdAt';

async function listAll(req, res) {
  const { agentId, q, date } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(LIST_PAGE_SIZE_MAX, Math.max(1, parseInt(req.query.limit, 10) || LIST_PAGE_SIZE));

  // Fetch one extra row to know whether another page exists without a separate count query.
  const rows = await Contact.find(buildContactFilter({ agentId, q, date }))
    .select(LIST_FIELDS)
    .populate('capturedBy', 'name email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const contacts = hasMore ? rows.slice(0, limit) : rows;
  return res.json({ contacts, hasMore });
}

// Agents who have captured at least one contact — powers the "filter/download by employee"
// picker. Scoped to actual capturers rather than every b2b_agent account, since an agent who
// hasn't scanned anything yet has nothing to filter down to.
async function listAgents(req, res) {
  const agentIds = await Contact.distinct('capturedBy');
  const agents = await User.find({ _id: { $in: agentIds } })
    .select('name')
    .sort({ name: 1 });
  return res.json({ agents: agents.map((a) => ({ id: a._id, name: a.name })) });
}

async function getContact(req, res) {
  const contact = await Contact.findById(req.params.id).populate('capturedBy', 'name email');
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  return res.json({ contact });
}

async function deleteContact(req, res) {
  const contact = await Contact.findById(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  if (!isSuperAdmin(req.user) && String(contact.capturedBy) !== String(req.user._id)) {
    return res.status(403).json({ error: 'You can only delete your own captured contacts' });
  }

  await contact.deleteOne();

  if (isSuperAdmin(req.user)) {
    await recordAudit({
      actor: req.user,
      action: 'contact.deleted',
      targetType: 'contact',
      targetId: contact._id,
      targetLabel: contact.name || contact.company || 'Unnamed contact',
      summary: `Deleted business card contact ${contact.name || contact.company || ''}`.trim(),
      metadata: { capturedBy: String(contact.capturedBy), company: contact.company },
    });
  }

  return res.status(204).send();
}

async function geminiDiagnostic(req, res) {
  const result = await testConnection();
  return res.json(result);
}

module.exports = {
  scanCard,
  createContact,
  exportContacts,
  listAll,
  listAgents,
  getContact,
  deleteContact,
  geminiDiagnostic,
};
