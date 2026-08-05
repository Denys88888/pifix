import multer from 'multer';
import { ALLOWED_MIME, MAX_FILE_BYTES } from '../lib/cloudinary';
import { badRequest } from '../lib/errors';

/**
 * Files never touch the disk: they are buffered in memory, validated, then
 * streamed straight to Cloudinary. Keeps Render's ephemeral filesystem clean
 * and removes a whole class of path-traversal problems.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 10 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME.includes(file.mimetype as (typeof ALLOWED_MIME)[number])) {
      callback(badRequest('invalid_file_type', 'Only JPEG and PNG images are accepted'));
      return;
    }
    callback(null, true);
  },
});

/** JPEG (FF D8 FF) and PNG (89 50 4E 47) magic bytes — the mimetype header alone is a claim, not proof. */
export function looksLikeImage(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  return isJpeg || isPng;
}
