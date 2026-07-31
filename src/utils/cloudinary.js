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
    // The account-wide `signature_algorithm: 'sha256'` set in configureCloudinary() above only
    // covers config-level fallbacks (e.g. the URL signer) — the SDK's per-request signer
    // (utils/index.js sign_request) reads `options.signature_algorithm` directly and does NOT
    // fall back to the global config, so every signed API call needs it passed explicitly too,
    // or it silently reverts to SHA-1 and this account rejects the request as "Invalid Signature".
    const stream = cld.uploader.upload_stream(
      { folder, resource_type: resourceType, signature_algorithm: 'sha256' },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

function destroyAsset(publicId, resourceType = 'image') {
  const cld = configureCloudinary();
  return cld.uploader.destroy(publicId, { resource_type: resourceType, signature_algorithm: 'sha256' });
}

module.exports = { isUploadEnabled, uploadBuffer, destroyAsset };
