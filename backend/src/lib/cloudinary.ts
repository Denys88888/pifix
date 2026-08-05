import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { env } from '../config/env';
import { badRequest, serverError } from './errors';
import { logger } from './logger';

if (env.cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
} else {
  logger.warn('Cloudinary is not configured — image uploads will be rejected');
}

export const ALLOWED_MIME = ['image/jpeg', 'image/png'] as const;
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export type UploadFolder = 'avatars' | 'portfolio' | 'orders' | 'certificates' | 'verification';

/**
 * Uploads a buffer to Cloudinary. `verification` documents go to a separate
 * folder with `type: authenticated` so that ID scans are not publicly readable.
 */
export function uploadImage(
  buffer: Buffer,
  folder: UploadFolder,
  mimetype: string,
): Promise<{ url: string; publicId: string }> {
  if (!env.cloudinaryConfigured) {
    throw serverError('uploads_unavailable', 'Cloudinary is not configured on this server');
  }
  if (!ALLOWED_MIME.includes(mimetype as (typeof ALLOWED_MIME)[number])) {
    throw badRequest('invalid_file_type', 'Only JPEG and PNG images are accepted');
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw badRequest('file_too_large', 'Maximum file size is 5 MB');
  }

  const isPrivate = folder === 'verification';

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${env.CLOUDINARY_FOLDER}/${folder}`,
        resource_type: 'image',
        type: isPrivate ? 'authenticated' : 'upload',
        overwrite: false,
        // Normalise: strip EXIF (incl. GPS), cap dimensions, re-encode.
        transformation: [
          { width: folder === 'avatars' ? 512 : 1600, crop: 'limit' },
          { quality: 'auto:good', fetch_format: 'auto' },
        ],
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) {
          logger.error('Cloudinary upload failed', { error: error?.message });
          reject(serverError('upload_failed', 'Image upload failed'));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

export async function deleteImage(publicId: string): Promise<void> {
  if (!env.cloudinaryConfigured) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    logger.warn('Cloudinary delete failed', { publicId, error: (error as Error).message });
  }
}

/** Signed, short-lived URL for admin review of authenticated (private) assets. */
export function signedUrl(publicIdValue: string, ttlSeconds = 600): string {
  return cloudinary.url(publicIdValue, {
    type: 'authenticated',
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}
