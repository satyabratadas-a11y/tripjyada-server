const { v2: cloudinary } = require('cloudinary');

function isUploadEnabled() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    // This Cloudinary account's Security settings require SHA-256 signatures; the SDK defaults
    // to SHA-1, which the account rejects as "Invalid Signature" even with a correct secret.
    signature_algorithm: 'sha256',
  });
  return cloudinary;
}

/** Uploads a multer memory-storage buffer to Cloudinary via a stream (no temp files on disk). */
function uploadBuffer(buffer, { folder, resourceType = 'auto' } = {}) {
  const cld = configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cld.uploader.upload_stream({ folder, resource_type: resourceType }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

function destroyAsset(publicId, resourceType = 'image') {
  const cld = configureCloudinary();
  return cld.uploader.destroy(publicId, { resource_type: resourceType });
}

module.exports = { isUploadEnabled, uploadBuffer, destroyAsset };
