const mongoose = require('mongoose');

const DOCUMENT_TYPES = ['link', 'file'];

const documentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: DOCUMENT_TYPES },
    url: { type: String, trim: true, default: '' },
    fileId: { type: mongoose.Schema.Types.ObjectId, default: null },
    mimeType: { type: String, trim: true, default: '' },
    size: { type: Number, default: 0 },
    name: { type: String, trim: true, default: '' },
    // Cloudinary-era fields — no longer written, kept so documents uploaded before the GridFS
    // migration still serialize and stay openable.
    publicId: { type: String, default: '' },
    resourceType: { type: String, default: '' },
    updatedAt: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    tag: { type: String, trim: true, default: 'Team' },
    description: {
      type: String,
      trim: true,
      default: 'Open the latest department file and manage access from here.',
    },
    order: { type: Number, default: 0 },
    document: { type: documentSchema, default: () => ({}) },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

departmentSchema.index({ order: 1, createdAt: 1 });

module.exports = mongoose.model('Department', departmentSchema);
module.exports.DOCUMENT_TYPES = DOCUMENT_TYPES;
