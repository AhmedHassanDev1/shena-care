import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MAX_FILE_SIZE } from '../security/upload-validator';

@Injectable()
export class StorageService {
  private readonly storageDir = path.resolve(process.env.STORAGE_LOCAL_PATH || path.join(process.cwd(), 'uploads'));
  private readonly baseUrl = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');

  constructor() { fs.mkdirSync(this.storageDir, { recursive: true }); }

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
        b.toString('ascii', 0, 5) === '%PDF-' && b.subarray(-1024).includes(Buffer.from('%%EOF')));
    if (!valid) throw new BadRequestException('Unsupported or malformed file content');
  }

  async uploadFile(file: Express.Multer.File, isPrivate: boolean, folder: string, supplierId?: string): Promise<string> {
    this.validateFile(file);
    if (!/^[a-zA-Z0-9_-]+$/.test(folder) ||
        (isPrivate && (!supplierId || !/^[a-zA-Z0-9_-]+$/.test(supplierId)))) {
      throw new BadRequestException('Invalid storage owner or folder');
    }
    const filename = `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
    const logicalFolder = isPrivate ? `private/${supplierId}/${folder}` : `public/${folder}`;
    const filePath = this.getFilePath(`${logicalFolder}/${filename}`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Validate the now-existing parent against symlink/junction escapes.
    if (!fs.realpathSync(path.dirname(filePath)).startsWith(fs.realpathSync(this.storageDir) + path.sep)) {
      throw new BadRequestException('Invalid storage path');
    }
    fs.writeFileSync(filePath, file.buffer, { flag: 'wx' });
    return `${this.baseUrl}/storage/${logicalFolder}/${filename}`;
  }

  getFilePath(logicalPath: string): string {
    if (!/^(public\/[a-zA-Z0-9_-]+|private\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(logicalPath)) {
      throw new BadRequestException('Invalid storage path');
    }
    const resolved = path.resolve(this.storageDir, logicalPath);
    if (!resolved.startsWith(this.storageDir + path.sep)) throw new BadRequestException('Invalid storage path');
    if (fs.existsSync(resolved) && !fs.realpathSync(resolved).startsWith(fs.realpathSync(this.storageDir) + path.sep)) {
      throw new BadRequestException('Invalid storage path');
    }
    return resolved;
  }

  privateObjectPath(url: string, supplierId: string): string {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new BadRequestException('Invalid media URL'); }
    const base = new URL(this.baseUrl);
    const prefix = `/storage/private/${supplierId}/candidates/`;
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith(prefix) || parsed.search || parsed.hash) {
      throw new BadRequestException('Media is not owned by this candidate supplier');
    }
    return this.getFilePath(parsed.pathname.slice('/storage/'.length));
  }

  copyToPublic(privateUrl: string, supplierId: string): string {
    const sourcePath = this.privateObjectPath(privateUrl, supplierId);
    if (!fs.existsSync(sourcePath)) throw new NotFoundException('Media object missing');
    const filename = path.basename(sourcePath);
    const destPath = this.getFilePath(`public/media/${filename}`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    if (!fs.realpathSync(path.dirname(destPath)).startsWith(fs.realpathSync(this.storageDir) + path.sep)) {
      throw new BadRequestException('Invalid storage path');
    }
    if (!fs.existsSync(destPath)) {
      try { fs.copyFileSync(sourcePath, destPath, fs.constants.COPYFILE_EXCL); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    return `${this.baseUrl}/storage/public/media/${filename}`;
  }
}
