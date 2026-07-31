const mongoose = require('mongoose');

const BUCKET_NAME = 'departmentDocuments';

// Stored on the same Atlas cluster the app already connects to for everything else — no
// external service, no API keys, nothing that can drift out of sync with what's actually
// configured on the running process.
function getBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
}

/** Uploads a multer memory-storage buffer to GridFS, resolving with the new file's ObjectId. */
function uploadBuffer(buffer, { filename, contentType }) {
  return new Promise((resolve, reject) => {
    const uploadStream = getBucket().openUploadStream(filename, { contentType });
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });
}

/** Returns a readable stream of the stored file's bytes, or null if it doesn't exist. */
async function openDownloadStream(fileId) {
  const bucket = getBucket();
  const files = await bucket.find({ _id: fileId }).toArray();
  if (files.length === 0) return null;
  return { stream: bucket.openDownloadStream(fileId), file: files[0] };
}

async function deleteFile(fileId) {
  if (!fileId) return;
  await getBucket().delete(fileId);
}

module.exports = { uploadBuffer, openDownloadStream, deleteFile };
