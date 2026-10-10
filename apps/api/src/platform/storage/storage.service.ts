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

  async uploadFile(file: Express.Multer.File, folder: string = 'media'): Promise<string> {
    try {
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomUUID()}${ext}`;
      const folderPath = path.join(this.storageDir, folder);
      
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      const filePath = path.join(folderPath, filename);
      fs.writeFileSync(filePath, file.buffer);
      
      this.logger.log(`File saved to ${filePath}`);
      // Use API_URL if defined, else fallback to a relative or local URL
      return `${this.baseUrl}/storage/${folder}/${filename}`;
    } catch (error) {
      this.logger.error('Failed to save file', error);
      throw new InternalServerErrorException('Failed to process file upload');
    }
  }

  getFilePath(folder: string, filename: string): string {
    return path.join(this.storageDir, folder, filename);
  }
}
