const multer = require('multer');
const cloudinary = require('../utils/cloudinary');

const ALLOWED_MIMETYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_FORMATS   = ['jpg', 'jpeg', 'png', 'webp'];

class CloudinaryStorageV2 {
  _handleFile(_req, file, cb) {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'ssi/students',
        allowed_formats: ALLOWED_FORMATS,
        transformation: [{ width: 300, height: 300, crop: 'fill', gravity: 'face' }],
      },
      (error, result) => {
        if (error) return cb(error);
        cb(null, {
          path:     result.secure_url,
          filename: result.public_id,
          size:     result.bytes,
        });
      },
    );
    file.stream.pipe(uploadStream);
  }

  _removeFile(_req, file, cb) {
    cloudinary.uploader.destroy(file.filename, cb);
  }
}

const upload = multer({
  storage: new CloudinaryStorageV2(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
    cb(null, true);
  },
});

module.exports = upload;
