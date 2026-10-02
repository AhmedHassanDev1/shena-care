import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';

@Injectable()
export class MagicByteValidationPipe implements PipeTransform {
  async transform(value: Express.Multer.File | Express.Multer.File[]) {
    if (!value) {
      return value;
    }

    const files = Array.isArray(value) ? value : [value];

    for (const file of files) {
      if (!file.buffer) {
        continue;
      }

      // Check magic bytes
      const fileType = await fileTypeFromBuffer(file.buffer);
      if (!fileType) {
        throw new BadRequestException(`Could not determine file type for ${file.originalname}`);
      }

      if (fileType.mime !== file.mimetype) {
        throw new BadRequestException(
          `File type mismatch for ${file.originalname}. Expected ${file.mimetype}, got ${fileType.mime}`
        );
      }
    }

    return value;
  }
}
