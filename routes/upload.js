/**
 * /api/upload  — file upload endpoint used by the compose / campaign UI.
 *
 *   POST /api/upload          single file (field: "file")
 *   POST /api/upload/multi    up to 5 files (field: "files")
 *   DELETE /api/upload/:name  delete a previously-uploaded file
 */

const path    = require('path');
const fs      = require('fs');
const express = require('express');
const multer  = require('multer');
const { authenticate } = require('../helpers/auth');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SIZE = 64 * 1024 * 1024; // 64 MB

const MIME_TO_TYPE = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video',
};
function mimeToFileType(mime) {
  return MIME_TO_TYPE[mime] || 'document';
}

function safeName(original) {
  const ext  = path.extname(original).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const base = path.basename(original, path.extname(original))
    .replace(/[^a-z0-9_\-]/gi, '_')
    .slice(0, 40);
  return `${Date.now()}_${base}${ext}`;
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => cb(null, safeName(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/csv',
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`File type ${file.mimetype} is not allowed`));
  },
});

function fileResponse(file) {
  const url = `/uploads/${file.filename}`;
  return {
    url,
    filename:     file.filename,
    originalName: file.originalname,
    mimetype:     file.mimetype,
    size:         file.size,
    fileType:     mimeToFileType(file.mimetype),
  };
}

const router = express.Router();
router.use(authenticate);

// Single file
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  res.json(fileResponse(req.file));
});

// Multiple files (up to 5)
router.post('/multi', upload.array('files', 5), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });
  res.json({ files: req.files.map(fileResponse) });
});

// Delete
router.delete('/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const fp   = path.join(UPLOAD_DIR, name);
  if (fs.existsSync(fp)) {
    fs.unlink(fp, () => {});
  }
  res.json({ ok: true });
});

// Multer error handler
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'Upload failed' });
});

module.exports = router;
