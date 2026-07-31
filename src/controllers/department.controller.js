const Department = require('../models/Department');
const { isUploadEnabled, uploadBuffer, destroyAsset } = require('../utils/cloudinary');

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
  const hasDocument = Boolean(obj.document && obj.document.url);
  return {
    id: obj._id,
    name: obj.name,
    tag: obj.tag,
    description: obj.description,
    order: obj.order,
    document: hasDocument
      ? {
          type: obj.document.type,
          url: obj.document.url,
          name: obj.document.name,
          resourceType: obj.document.resourceType,
          updatedAt: obj.document.updatedAt,
        }
      : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

/** Extension-based resource type: Cloudinary only auto-detects image/video, everything else
 * (xlsx, csv, pdf, docx…) needs to be stored as 'raw' or it fails to upload. */
function resourceTypeFor(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'raw';
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

  if (isUploadEnabled() && department.document?.publicId) {
    await destroyAsset(department.document.publicId, department.document.resourceType || 'raw').catch((err) => {
      console.error('[cloudinary] failed to delete asset:', err);
    });
  }
  await department.deleteOne();
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

  if (isUploadEnabled() && department.document?.publicId) {
    await destroyAsset(department.document.publicId, department.document.resourceType || 'raw').catch((err) => {
      console.error('[cloudinary] failed to delete asset:', err);
    });
  }

  department.document = {
    type: 'link',
    url,
    name: req.body.name?.trim() || department.name,
    publicId: '',
    resourceType: '',
    updatedAt: new Date(),
    updatedBy: req.user._id,
  };
  await department.save();
  return res.json({ department: serializeDepartment(department) });
}

/** Uploads an Excel/Sheet/other file for this department, replacing any prior upload. */
async function uploadDocument(req, res) {
  if (!isUploadEnabled()) {
    return res.status(503).json({ error: 'File uploads are not configured. Add CLOUDINARY_* keys to server/.env to enable them.' });
  }
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: 'Department not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const previous = department.document?.publicId
    ? { publicId: department.document.publicId, resourceType: department.document.resourceType || 'raw' }
    : null;

  const resourceType = resourceTypeFor(req.file.mimetype);
  let result;
  try {
    result = await uploadBuffer(req.file.buffer, { folder: 'office-portal/departments', resourceType });
  } catch (err) {
    console.error('[cloudinary] upload failed:', err);
    // Cloudinary's own error payload (e.g. "Invalid Signature ... String to sign - 'folder=…'")
    // only ever echoes back public request params, never the secret, so — unlike an unclassified
    // exception — it's safe to forward to the client. That turns "check the server logs we can't
    // reach" into "read the response body", which is the whole point of exposing it here.
    const reason = err && err.http_code ? err.message : 'Unknown error';
    return res.status(502).json({ error: `Cloudinary rejected the upload: ${reason}` });
  }

  department.document = {
    type: 'file',
    url: result.secure_url,
    name: req.body.name?.trim() || req.file.originalname,
    publicId: result.public_id,
    resourceType,
    updatedAt: new Date(),
    updatedBy: req.user._id,
  };
  await department.save();

  if (previous) {
    await destroyAsset(previous.publicId, previous.resourceType).catch((err) => {
      console.error('[cloudinary] failed to delete previous asset:', err);
    });
  }

  return res.status(201).json({ department: serializeDepartment(department) });
}

async function removeDocument(req, res) {
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: 'Department not found' });

  if (isUploadEnabled() && department.document?.publicId) {
    await destroyAsset(department.document.publicId, department.document.resourceType || 'raw').catch((err) => {
      console.error('[cloudinary] failed to delete asset:', err);
    });
  }
  department.document = {};
  await department.save();
  return res.json({ department: serializeDepartment(department) });
}

module.exports = {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  setDocumentLink,
  uploadDocument,
  removeDocument,
};
