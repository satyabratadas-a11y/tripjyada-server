const mongoose = require('mongoose');

const influencerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    influencerId: { type: String, trim: true, default: '' },
    niche: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    remarks: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

influencerSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Influencer', influencerSchema);
