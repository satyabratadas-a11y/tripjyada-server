const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, trim: true, default: '' },
    company: { type: String, trim: true, default: '' },
    jobTitle: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    website: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    rawOcrText: { type: String, default: '' },
    // A data: URI (base64) — the card photo is stored directly in Mongo rather than a third-party
    // host, so this doubles as both the storage and the URL an <img src> can use as-is. Empty for
    // contacts entered manually with no scanned photo.
    imageUrl: { type: String, default: '' },
    // Optional photo of the back of the card — scanning the back is optional, so this may be empty.
    backImageUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

contactSchema.index({ capturedBy: 1, createdAt: -1 });

module.exports = mongoose.model('Contact', contactSchema);
