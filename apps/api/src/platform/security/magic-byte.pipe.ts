import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { hasValidFileSignature } from './file-signature';

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

      // Declared type, extension and content bytes must agree
      if (!hasValidFileSignature(file)) {
        throw new BadRequestException(`File type mismatch for ${file.originalname}`);
      }
    }

    return value;
  }
}
