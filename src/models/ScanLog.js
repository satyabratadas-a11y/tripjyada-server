const mongoose = require('mongoose');

// One row per card-scan attempt (the POST /api/contacts/scan call) — separate from Contact, which
// only gets a row once an agent reviews and saves. This is what actually tracks Gemini/Vision API
// spend: every attempt here was a billed call, whether or not it ever became a saved contact.
const scanLogSchema = new mongoose.Schema(
  {
    capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    outcome: { type: String, enum: ['success', 'failure'], required: true },
    errorMessage: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

scanLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ScanLog', scanLogSchema);
