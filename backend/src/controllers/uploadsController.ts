import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors';
import { uploadImage, type UploadFolder } from '../lib/cloudinary';
import { looksLikeImage } from '../middleware/upload';

const FOLDERS: UploadFolder[] = ['avatars', 'portfolio', 'orders', 'certificates', 'verification'];

const folderSchema = z.object({ folder: z.enum(['avatars', 'portfolio', 'orders', 'certificates', 'verification']) });

/**
 * Uploads go through the server (not a browser→Cloudinary signature) so the
 * size, the declared mimetype AND the actual magic bytes are all checked before
 * anything is stored.
 */
export async function uploadImages(req: Request, res: Response): Promise<void> {
  const { folder } = folderSchema.parse(req.params);
  if (!FOLDERS.includes(folder)) throw badRequest('invalid_folder', 'Unknown upload folder');

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw badRequest('no_files', 'No files were uploaded');

  const maxPerFolder: Record<UploadFolder, number> = {
    avatars: 1,
    portfolio: 10,
    orders: 3,
    certificates: 10,
    verification: 4,
  };
  if (files.length > maxPerFolder[folder]) {
    throw badRequest('too_many_files', `At most ${maxPerFolder[folder]} file(s) for ${folder}`);
  }

  const uploaded = [];
  for (const file of files) {
    if (!looksLikeImage(file.buffer)) {
      throw badRequest('invalid_file_content', 'The file is not a valid JPEG or PNG image');
    }
    uploaded.push(await uploadImage(file.buffer, folder, file.mimetype));
  }

  res.status(201).json({ files: uploaded });
}
