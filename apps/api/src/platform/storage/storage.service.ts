import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageDir = path.join(process.cwd(), 'uploads');
  private readonly baseUrl = process.env.API_URL || 'http://localhost:3001';

  constructor() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async uploadFile(file: Express.Multer.File, isPrivate: boolean, folder: string, supplierId?: string): Promise<string> {
    try {
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomUUID()}${ext}`;
      
      const logicalFolder = isPrivate && supplierId ? `private/${supplierId}/${folder}` : `public/${folder}`;
      const folderPath = path.join(this.storageDir, logicalFolder);
      
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      const filePath = path.join(folderPath, filename);
      fs.writeFileSync(filePath, file.buffer);
      
      this.logger.log(`File saved to ${filePath}`);
      this.logger.log(`File saved to ${filePath}`);
      return `${this.baseUrl}/storage/${logicalFolder}/${filename}`;
    } catch (error) {
      this.logger.error('Failed to save file', error);
      throw new InternalServerErrorException('Failed to process file upload');
    }
  }

  getFilePath(logicalPath: string): string {
    // logicalPath can be something like public/candidates/123.png
    return path.join(this.storageDir, logicalPath);
  }

  copyToPublic(privateUrl: string): string {
    const urlParts = privateUrl.split('/storage/');
    if (urlParts.length < 2) return privateUrl; // Fallback

    const logicalPath = urlParts[1]; // e.g. private/123/candidates/foo.png
    const filename = path.basename(logicalPath);
    const publicFolder = `public/media`;
    
    const sourcePath = this.getFilePath(logicalPath);
    const destFolder = path.join(this.storageDir, publicFolder);
    const destPath = path.join(destFolder, filename);

    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }

    if (fs.existsSync(sourcePath) && !fs.existsSync(destPath)) {
      fs.copyFileSync(sourcePath, destPath);
    }

    return `${this.baseUrl}/storage/${publicFolder}/${filename}`;
  }
}
