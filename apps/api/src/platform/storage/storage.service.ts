import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import * as path from 'path';
import * as crypto from 'crypto';
import { MAX_FILE_SIZE } from '../security/upload-validator';
import { hasValidFileSignature } from '../security/file-signature';
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
    if (!hasValidFileSignature(file)) throw new BadRequestException('Unsupported or malformed file content');
  }

  async uploadFile(file: Express.Multer.File, isPrivate: boolean, folder: string, supplierId?: string): Promise<string> {
    this.validateFile(file);
    if (!/^[a-zA-Z0-9_-]+$/.test(folder) ||
        (isPrivate && (!supplierId || !/^[a-zA-Z0-9_-]+$/.test(supplierId)))) {
      throw new BadRequestException('Invalid storage owner or folder');
    }

    if (!isPrivate && file.mimetype.startsWith('image/') && process.env.MEDIA_STORAGE_PROVIDER === 'cloudinary') {
      const logicalFolder = `public/${folder}`;
      return this.mediaStoragePort.upload(file.buffer, { folder: logicalFolder, isPrivate: false, mimetype: file.mimetype });
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

  getFilePath(logicalPath: string): string {
    if (!/^(public\/[a-zA-Z0-9_-]+|private\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(logicalPath)) {
      throw new BadRequestException('Invalid storage path');
    }
    const storageDir = path.resolve(process.env.STORAGE_LOCAL_PATH || path.join(process.cwd(), 'uploads'));
    const resolved = path.resolve(storageDir, logicalPath);
    if (!resolved.startsWith(storageDir + path.sep)) throw new BadRequestException('Invalid storage path');
    return resolved;
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

    if (process.env.MEDIA_STORAGE_PROVIDER === 'cloudinary') {
      const stream = await this.storagePort.readStream(objectKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      return this.mediaStoragePort.upload(buffer, { folder: 'shena-care/products', isPrivate: false });
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

  /** Restore original bytes at a persisted private key without changing provenance URLs. */
  async restorePrivateFile(objectKey: string, file: Express.Multer.File, supplierId: string): Promise<void> {
    this.validateFile(file);
    this.getFilePath(objectKey);
    if (!objectKey.startsWith(`private/${supplierId}/`)) throw new BadRequestException('Storage object belongs to another supplier');
    await this.storagePort.put(objectKey, file.buffer, { size: file.buffer.length, mimeType: file.mimetype });
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
