// Uploads (photos, voice notes, documents). Files are stored under
// UPLOADS_DIR and served from /uploads/<name>.
//   POST /api/media/upload  (multipart: file | files[])  → { files: [{url, mimeType, size, fileName, kind}] }
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const prisma = require('../lib/prisma');
const config = require('../config');
const { ah, HttpError } = require('../lib/http');

const router = express.Router();
fs.mkdirSync(config.uploadsDir, { recursive: true });

const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/webm': '.webm',
  'audio/ogg': '.ogg', 'audio/wav': '.wav', 'application/pdf': '.pdf',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => {
    const ext = EXT[file.mimetype] || path.extname(file.originalname || '').slice(0, 8).toLowerCase() || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

function kindOf(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

router.post('/upload', upload.any(), ah(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw new HttpError(400, 'No file uploaded');
  const out = [];
  for (const f of files) {
    const row = await prisma.mediaFile.create({
      data: {
        workspaceId: req.workspaceId,
        url: `/uploads/${f.filename}`,
        mimeType: f.mimetype,
        fileName: f.originalname,
        size: f.size,
        kind: kindOf(f.mimetype),
        uploadedBy: req.userId,
      },
    });
    out.push({ id: row.id, url: row.url, mimeType: row.mimeType, size: row.size, fileName: row.fileName, kind: row.kind });
  }
  res.json({ files: out });
}));

module.exports = router;
