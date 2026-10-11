import { FileStoragePort, ObjectMetadata } from './storage.port';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { BadRequestException, NotFoundException } from '@nestjs/common';

export class LocalStorageAdapter implements FileStoragePort {
  private readonly storageDir = path.resolve(process.env.STORAGE_LOCAL_PATH || path.join(process.cwd(), 'uploads'));

  constructor() {
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  private getFilePath(objectKey: string): string {
    const resolved = path.resolve(this.storageDir, objectKey);
    if (!resolved.startsWith(this.storageDir + path.sep)) {
      throw new BadRequestException('Invalid storage path');
    }
    return resolved;
  }

  async put(objectKey: string, data: Buffer | Readable, metadata?: ObjectMetadata): Promise<void> {
    const filePath = this.getFilePath(objectKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    
    if (!fs.realpathSync(path.dirname(filePath)).startsWith(fs.realpathSync(this.storageDir) + path.sep)) {
      throw new BadRequestException('Invalid storage path');
    }

    if (Buffer.isBuffer(data)) {
      fs.writeFileSync(filePath, data);
    } else {
      const writeStream = fs.createWriteStream(filePath);
      data.pipe(writeStream);
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);
      });
    }
    
    if (metadata) {
      const metaPath = filePath + '.meta.json';
      fs.writeFileSync(metaPath, JSON.stringify(metadata));
    }
  }

  async readStream(objectKey: string): Promise<Readable> {
    const filePath = this.getFilePath(objectKey);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Object not found');
    }
    return fs.createReadStream(filePath);
  }

  async exists(objectKey: string): Promise<boolean> {
    const filePath = this.getFilePath(objectKey);
    return fs.existsSync(filePath);
  }

  async delete(objectKey: string): Promise<void> {
    const filePath = this.getFilePath(objectKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const metaPath = filePath + '.meta.json';
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  }
}
