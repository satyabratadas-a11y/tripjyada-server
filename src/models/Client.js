const mongoose = require('mongoose');

const CLIENT_ROLES = ['owner', 'editor', 'viewer'];

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    brandColor: { type: String, trim: true, default: '#F2701C' },
    logoUrl: { type: String, trim: true, default: '' },
    industry: { type: String, trim: true, default: '' },
    businessType: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    members: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        roleInClient: { type: String, enum: CLIENT_ROLES, default: 'editor' },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

clientSchema.index({ status: 1, name: 1 });

clientSchema.methods.roleFor = function roleFor(userId) {
  const membership = this.members.find((m) => String(m.user) === String(userId));
  return membership ? membership.roleInClient : null;
};

module.exports = mongoose.model('Client', clientSchema);
module.exports.CLIENT_ROLES = CLIENT_ROLES;
