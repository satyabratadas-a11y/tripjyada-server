const mongoose = require('mongoose');
const { USER_ROLES } = require('../utils/roles');

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true, trim: true },
    actorRole: { type: String, enum: USER_ROLES, required: true },
    action: { type: String, required: true, trim: true },
    targetType: { type: String, enum: ['user', 'task'], required: true },
    targetId: { type: String, required: true, trim: true },
    targetLabel: { type: String, trim: true, default: '' },
    summary: { type: String, required: true, trim: true },
    changes: { type: mongoose.Schema.Types.Mixed, default: {} },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
