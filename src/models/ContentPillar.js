const mongoose = require('mongoose');

const contentPillarSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, trim: true, default: '#6366F1' },
    description: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

contentPillarSchema.index({ client: 1, name: 1 });

module.exports = mongoose.model('ContentPillar', contentPillarSchema);
