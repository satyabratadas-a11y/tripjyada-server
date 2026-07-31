const Department = require('../models/Department');
const { uploadBuffer, openDownloadStream, deleteFile } = require('../utils/gridfs');

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function serializeDepartment(dept) {
  const obj = dept.toObject ? dept.toObject() : dept;
  const doc = obj.document;
  const hasDocument = Boolean(doc && (doc.fileId || doc.url));

  return {
    id: obj._id,
    name: obj.name,
    tag: obj.tag,
    description: obj.description,
    order: obj.order,
    document: hasDocument
      ? {
          type: doc.type,
          // A file stored in GridFS has no public URL of its own — it's served through our own
          // streaming route. A link (or a pre-migration Cloudinary upload) already has a real
          // absolute url, so that's used as-is.
          url: doc.fileId ? `/api/departments/${obj._id}/document/file` : doc.url,
          name: doc.name,
          mimeType: doc.mimeType || '',
          resourceType: doc.resourceType || '',
          updatedAt: doc.updatedAt,
        }
      : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

async function listDepartments(req, res) {
  const departments = await Department.find().sort({ order: 1, createdAt: 1 });
  return res.json({ departments: departments.map(serializeDepartment) });
}

async function createDepartment(req, res) {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const department = await Department.create({
    name,
    tag: req.body.tag?.trim() || 'Team',
    description: req.body.description?.trim() || undefined,
    order: Number.isFinite(req.body.order) ? req.body.order : (await Department.countDocuments()) + 1,
    createdBy: req.user._id,
  });

  return res.status(201).json({ department: serializeDepartment(department) });
}

async function updateDepartment(req, res) {
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: 'Department not found' });

  if (req.body.name !== undefined) {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    department.name = name;
  }
  if (req.body.tag !== undefined) department.tag = req.body.tag?.trim() || 'Team';
  if (req.body.description !== undefined) department.description = req.body.description?.trim() || '';
  if (req.body.order !== undefined && Number.isFinite(Number(req.body.order))) department.order = Number(req.body.order);

  await department.save();
  return res.json({ department: serializeDepartment(department) });
}

async function deleteDepartment(req, res) {
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: 'Department not found' });

  const fileId = department.document?.fileId || null;
  await department.deleteOne();

  if (fileId) {
    await deleteFile(fileId).catch((err) => {
      console.error('[gridfs] failed to delete file:', err);
    });
  }
  return res.status(204).send();
}

/** Shares a document by link (e.g. a Google Sheet) instead of an upload. */
async function setDocumentLink(req, res) {
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: 'Department not found' });

  const url = req.body.url?.trim();
  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).json({ error: 'A valid http(s) url is required' });
  }

  const previousFileId = department.document?.fileId || null;

  department.document = {
    type: 'link',
    url,
    fileId: null,
    mimeType: '',
    size: 0,
    name: req.body.name?.trim() || department.name,
    publicId: '',
    resourceType: '',
    updatedAt: new Date(),
    updatedBy: req.user._id,
  };
  await department.save();

  if (previousFileId) {
    await deleteFile(previousFileId).catch((err) => {
      console.error('[gridfs] failed to delete previous file:', err);
    });
  }

  return res.json({ department: serializeDepartment(department) });
}

/** Uploads an Excel/Sheet/other file for this department into GridFS, replacing any prior upload. */
async function uploadDocument(req, res) {
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: 'Department not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const previousFileId = department.document?.fileId || null;

  const fileId = await uploadBuffer(req.file.buffer, {
    filename: req.file.originalname,
    contentType: req.file.mimetype,
  });

  department.document = {
    type: 'file',
    url: '',
    fileId,
    mimeType: req.file.mimetype,
    size: req.file.size,
    name: req.body.name?.trim() || req.file.originalname,
    publicId: '',
    resourceType: '',
    updatedAt: new Date(),
    updatedBy: req.user._id,
  };
  await department.save();

  if (previousFileId) {
    await deleteFile(previousFileId).catch((err) => {
      console.error('[gridfs] failed to delete previous file:', err);
    });
  }

  return res.status(201).json({ department: serializeDepartment(department) });
}

/** Streams a GridFS-stored document straight from MongoDB — no external file host involved. */
async function downloadDocument(req, res) {
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: 'Department not found' });

  const fileId = department.document?.fileId;
  if (!fileId) return res.status(404).json({ error: 'No file stored for this department' });

  const found = await openDownloadStream(fileId);
  if (!found) return res.status(404).json({ error: 'File not found' });

  const safeName = (department.document.name || found.file.filename || 'document').replace(/"/g, '');
  res.set('Content-Type', found.file.contentType || department.document.mimeType || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(safeName)}"`);
  found.stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to read file' });
  });
  found.stream.pipe(res);
}

async function removeDocument(req, res) {
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: 'Department not found' });

  const fileId = department.document?.fileId || null;
  department.document = {};
  await department.save();

  if (fileId) {
    await deleteFile(fileId).catch((err) => {
      console.error('[gridfs] failed to delete file:', err);
    });
  }
  return res.json({ department: serializeDepartment(department) });
}

module.exports = {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  setDocumentLink,
  uploadDocument,
  downloadDocument,
  removeDocument,
};
