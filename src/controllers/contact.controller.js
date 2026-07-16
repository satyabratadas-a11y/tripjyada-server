const ExcelJS = require('exceljs');
const Contact = require('../models/Contact');
const { isSuperAdmin } = require('../utils/roles');
const { extractCardFields } = require('../utils/gemini');
const { recordAudit } = require('../utils/audit');

const CONTACT_FIELDS = ['name', 'company', 'jobTitle', 'phone', 'email', 'website', 'address', 'notes', 'rawOcrText'];

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
  console.log(`[scanCard] request handled in ${Date.now() - requestStartedAt}ms`);
  return res.json({ fields });
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

  // A scanned card always has a photo; a manually-entered contact has none — but it still needs at
  // least one identifying field, or there's nothing to save.
  if (!frontFile && !fields.name && !fields.company && !fields.phone && !fields.email) {
    return res.status(400).json({ error: 'Enter at least a name, company, phone, or email' });
  }

  const imageUrl = frontFile ? `data:${frontFile.mimetype};base64,${frontFile.buffer.toString('base64')}` : '';
  const backImageUrl = backFile ? `data:${backFile.mimetype};base64,${backFile.buffer.toString('base64')}` : '';

  const contact = await Contact.create({
    ...fields,
    capturedBy: req.user._id,
    imageUrl,
    backImageUrl,
  });

  return res.status(201).json({ contact });
}

async function listMine(req, res) {
  const contacts = await Contact.find({ capturedBy: req.user._id }).sort({ createdAt: -1 });
  return res.json({ contacts });
}

async function exportMine(req, res) {
  const contacts = await Contact.find({ capturedBy: req.user._id }).sort({ createdAt: -1 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Task Tracker';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('My Contacts');
  const header = sheet.addRow(['Date', 'Name', 'Company', 'Phone', 'Email', 'Address']);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  });

  for (const c of contacts) {
    sheet.addRow([c.createdAt.toISOString().slice(0, 10), c.name, c.company, c.phone, c.email, c.address]);
  }

  sheet.columns.forEach((col) => {
    col.width = 24;
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="my-contacts-${new Date().toISOString().slice(0, 10)}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}

async function listAll(req, res) {
  const { agentId, q } = req.query;
  const filter = {};
  if (agentId) filter.capturedBy = agentId;
  if (q) {
    const re = new RegExp(String(q).trim(), 'i');
    filter.$or = [{ name: re }, { company: re }];
  }

  const contacts = await Contact.find(filter).populate('capturedBy', 'name email').sort({ createdAt: -1 });
  return res.json({ contacts });
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

module.exports = { scanCard, createContact, listMine, exportMine, listAll, deleteContact };
