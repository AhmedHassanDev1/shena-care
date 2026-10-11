import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import * as path from 'path';
import * as crypto from 'crypto';
import { MAX_FILE_SIZE } from '../security/upload-validator';
import { FILE_STORAGE_PORT, FileStoragePort } from './storage.port';
import { MEDIA_STORAGE_PORT, MediaStoragePort } from './media-storage.port';

@Injectable()
export class StorageService {
  private readonly baseUrl = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');

  constructor(
    @Inject(FILE_STORAGE_PORT) private readonly storagePort: FileStoragePort,
    @Inject(MEDIA_STORAGE_PORT) private readonly mediaStoragePort: MediaStoragePort,
  ) {}

  validateFile(file: Express.Multer.File): void {
    if (!file?.buffer?.length || file.buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException('File must contain between 1 byte and 5 MB');
    }
    const b = file.buffer;
    const ext = path.extname(file.originalname).toLowerCase();
    const valid =
      (file.mimetype === 'image/png' && ext === '.png' && b.length >= 67 &&
        b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
        b.toString('ascii', 12, 16) === 'IHDR' && b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0 &&
        b.toString('ascii', b.length - 8, b.length - 4) === 'IEND') ||
      (file.mimetype === 'image/jpeg' && ['.jpg', '.jpeg'].includes(ext) && b.length > 20 &&
        b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9) ||
      (file.mimetype === 'image/webp' && ext === '.webp' && b.length > 20 &&
        b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' &&
        b.readUInt32LE(4) + 8 === b.length) ||
      (file.mimetype === 'application/pdf' && ext === '.pdf' && b.length > 10 &&
        b.toString('ascii', 0, 5) === '%PDF-' && b.subarray(-1024).includes(Buffer.from('%%EOF'))) ||
      (file.mimetype === 'text/csv' && ext === '.csv') ||
      (file.mimetype === 'application/vnd.ms-excel' && ext === '.xls') ||
      (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && ext === '.xlsx');
    if (!valid) throw new BadRequestException('Unsupported or malformed file content');
  }

  async uploadFile(file: Express.Multer.File, isPrivate: boolean, folder: string, supplierId?: string): Promise<string> {
    this.validateFile(file);
    if (!/^[a-zA-Z0-9_-]+$/.test(folder) ||
        (isPrivate && (!supplierId || !/^[a-zA-Z0-9_-]+$/.test(supplierId)))) {
      throw new BadRequestException('Invalid storage owner or folder');
    }

    if (file.mimetype.startsWith('image/')) {
      const logicalFolder = isPrivate ? `private/${supplierId}/${folder}` : `public/${folder}`;
      return this.mediaStoragePort.upload(file.buffer, { folder: logicalFolder, isPrivate, mimetype: file.mimetype });
    }

    const filename = `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
    const logicalFolder = isPrivate ? `private/${supplierId}/${folder}` : `public/${folder}`;
    const objectKey = `${logicalFolder}/${filename}`;
    
    await this.storagePort.put(objectKey, file.buffer, {
      size: file.buffer.length,
      mimeType: file.mimetype,
    });
    
    return `${this.baseUrl}/storage/${objectKey}`;
  }

  // Parses a URL and returns the object key if valid
  privateObjectKey(url: string, supplierId: string): string {
    if (url.startsWith('cloudinary://')) {
      return url;
    }
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new BadRequestException('Invalid media URL'); }
    const base = new URL(this.baseUrl);
    const prefix = `/storage/private/${supplierId}/candidates/`;
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith(prefix) || parsed.search || parsed.hash) {
      throw new BadRequestException('Media is not owned by this candidate supplier');
    }
    return parsed.pathname.slice('/storage/'.length);
  }

  async copyToPublic(privateUrl: string, supplierId: string): Promise<string> {
    const objectKey = this.privateObjectKey(privateUrl, supplierId);

    if (objectKey.startsWith('cloudinary://')) {
      return this.mediaStoragePort.publishMedia(objectKey);
    }

    if (!(await this.storagePort.exists(objectKey))) {
      throw new NotFoundException('Media object missing');
    }
    const filename = path.basename(objectKey);
    const destKey = `public/media/${filename}`;
    
    if (!(await this.storagePort.exists(destKey))) {
      // Stream copy via read/put
      const stream = await this.storagePort.readStream(objectKey);
      await this.storagePort.put(destKey, stream);
    }
    return `${this.baseUrl}/storage/${destKey}`;
  }

  async exists(objectKey: string): Promise<boolean> {
    return this.storagePort.exists(objectKey);
  }

  async deleteFile(url: string, supplierId?: string): Promise<void> {
    if (url.startsWith('cloudinary://')) {
      await this.mediaStoragePort.delete(url);
      return;
    }
    const objectKey = url.includes('/storage/') ? url.split('/storage/')[1] : url;
    await this.storagePort.delete(objectKey);
  }
}
