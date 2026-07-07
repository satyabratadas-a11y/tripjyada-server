const mongoose = require('mongoose');

const contentCommentSchema = new mongoose.Schema(
  {
    entry: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentEntry', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

contentCommentSchema.index({ entry: 1, createdAt: 1 });

module.exports = mongoose.model('ContentComment', contentCommentSchema);
