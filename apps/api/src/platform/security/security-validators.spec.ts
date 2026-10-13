import { validateSafeUrl } from './url-validator';
import { sanitizeCsvField } from './csv-sanitizer';
import { MagicByteValidationPipe } from './magic-byte.pipe';
import { BadRequestException } from '@nestjs/common';

// 1x1 PNG with valid IHDR/IEND chunks.
const upload = (originalname: string, mimetype: string, buffer: Buffer) => ({ originalname, mimetype, buffer }) as Express.Multer.File;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/bkAAAAASUVORK5CYII=', 'base64');

describe('Security Validators', () => {
  describe('SSRF / URL Validator', () => {
    it('should reject localhost', () => {
      expect(() => validateSafeUrl('http://localhost/admin')).toThrow(BadRequestException);
    });

    it('should reject private IPs', () => {
      expect(() => validateSafeUrl('http://192.168.1.1/internal')).toThrow(BadRequestException);
      expect(() => validateSafeUrl('https://10.0.0.1/')).toThrow(BadRequestException);
      expect(() => validateSafeUrl('http://127.0.0.1/')).toThrow(BadRequestException);
    });

    it('should reject dangerous schemes', () => {
      expect(() => validateSafeUrl('ftp://example.com/')).toThrow(BadRequestException);
      expect(() => validateSafeUrl('file:///etc/passwd')).toThrow(BadRequestException);
    });

    it('should allow valid public URLs', () => {
      expect(() => validateSafeUrl('https://example.com/product/123')).not.toThrow();
    });
  });

  describe('CSV Sanitizer', () => {
    it('should escape formula injection payloads', () => {
      expect(sanitizeCsvField('=1+1')).toBe("'=" + "1+1");
      expect(sanitizeCsvField('+cmd|')).toBe("'+cmd|");
      expect(sanitizeCsvField('-calc')).toBe("'-calc");
      expect(sanitizeCsvField('@SUM(1,1)')).toBe("'@SUM(1,1)");
    });

    it('should allow normal text', () => {
      expect(sanitizeCsvField('Hello world')).toBe('Hello world');
      expect(sanitizeCsvField('12345')).toBe('12345');
    });
  });

  describe('Magic Byte Validator', () => {
    let pipe: MagicByteValidationPipe;

    beforeEach(() => {
      pipe = new MagicByteValidationPipe();
    });

    it('should reject file if magic bytes do not match mime type', async () => {
      const mockFile = {
        originalname: 'image.png',
        mimetype: 'image/png',
        buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(80)]), // PE executable header
      } as any;

      await expect(pipe.transform(mockFile)).rejects.toThrow(BadRequestException);
    });

    it('should reject real image bytes declared as another type or extension', async () => {
      await expect(pipe.transform(upload('image.jpg', 'image/jpeg', PNG))).rejects.toThrow(BadRequestException);
      await expect(pipe.transform(upload('image.exe', 'image/png', PNG))).rejects.toThrow(BadRequestException);
      await expect(pipe.transform([upload('a.png', 'image/png', PNG), upload('b.png', 'image/png', PNG.subarray(0, 40))]))
        .rejects.toThrow(BadRequestException);
    });

    it('should allow file if magic bytes match mime type', async () => {
      const mockFile = {
        originalname: 'real-image.png',
        mimetype: 'image/png',
        buffer: PNG,
      } as any;

      const result = await pipe.transform(mockFile);
      expect(result).toBe(mockFile);
    });
  });
});
