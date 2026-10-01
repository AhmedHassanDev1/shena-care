import { BadRequestException } from '@nestjs/common';
import { extname } from 'path';
import * as multer from 'multer';

// 5MB limit for MVP
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.pdf'
]);

export const multerOptions = {
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`));
    }
    
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new BadRequestException(`Unsupported file extension: ${ext}`));
    }
    
    cb(null, true);
  },
  // In a real production app, we would use memory storage or a secure S3 bucket
  // rather than disk storage to avoid arbitrary file writing. For MVP:
  storage: multer.memoryStorage(),
};
