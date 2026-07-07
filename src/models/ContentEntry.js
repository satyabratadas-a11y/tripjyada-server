const mongoose = require('mongoose');

const CONTENT_FORMATS = ['Creative', 'Carousel', 'Reel', 'Story', 'Video', 'Blog'];
const PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'YouTube', 'X'];
const CONTENT_STATUSES = ['Idea', 'Draft', 'Designing', 'Review', 'Approved', 'Scheduled', 'Published'];
const APPROVAL_STATUSES = ['Pending', 'Approved', 'Rejected', 'Changes Requested'];

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    resourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'image' },
    name: { type: String, trim: true, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const historyEntrySchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const contentEntrySchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    date: { type: Date, required: true },
    time: { type: String, trim: true, default: '' },
    format: { type: String, enum: CONTENT_FORMATS, default: 'Creative' },
    pillar: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentPillar', default: null },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    idea: { type: String, trim: true, default: '' },
    hook: { type: String, trim: true, default: '' },
    caption: { type: String, trim: true, default: '' },
    cta: { type: String, trim: true, default: '' },
    platform: { type: String, enum: PLATFORMS, default: 'Instagram' },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: CONTENT_STATUSES, default: 'Idea' },
    approvalStatus: { type: String, enum: APPROVAL_STATUSES, default: 'Pending' },
    reviewNote: { type: String, trim: true, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    order: { type: Number, default: 0 },
    history: { type: [historyEntrySchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

contentEntrySchema.index({ client: 1, date: 1 });
contentEntrySchema.index({ client: 1, status: 1 });
contentEntrySchema.index({ client: 1, assignee: 1 });

module.exports = mongoose.model('ContentEntry', contentEntrySchema);
module.exports.CONTENT_FORMATS = CONTENT_FORMATS;
module.exports.PLATFORMS = PLATFORMS;
module.exports.CONTENT_STATUSES = CONTENT_STATUSES;
module.exports.APPROVAL_STATUSES = APPROVAL_STATUSES;
