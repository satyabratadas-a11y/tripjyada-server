const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    name: { type: String, required: true, trim: true },
    phase: { type: String, trim: true, default: '' },
    startDate: { type: Date },
    endDate: { type: Date },
    color: { type: String, trim: true, default: '#10B981' },
    status: { type: String, enum: ['planned', 'active', 'completed'], default: 'planned' },
  },
  { timestamps: true }
);

campaignSchema.index({ client: 1, name: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
