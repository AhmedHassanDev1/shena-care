import { validateSafeUrl } from './url-validator';
import { sanitizeCsvField } from './csv-sanitizer';
import { MagicByteValidationPipe } from './magic-byte.pipe';
import { BadRequestException } from '@nestjs/common';
import * as fileType from 'file-type';

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn(),
}));

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
      jest.clearAllMocks();
    });

    it('should reject file if magic bytes do not match mime type', async () => {
      (fileType.fileTypeFromBuffer as jest.Mock).mockResolvedValue({
        ext: 'exe',
        mime: 'application/x-msdownload',
      });

      const mockFile = {
        originalname: 'image.png',
        mimetype: 'image/png',
        buffer: Buffer.from('mock-exe-data'),
      } as any;

      await expect(pipe.transform(mockFile)).rejects.toThrow(BadRequestException);
    });

    it('should allow file if magic bytes match mime type', async () => {
      (fileType.fileTypeFromBuffer as jest.Mock).mockResolvedValue({
        ext: 'png',
        mime: 'image/png',
      });

      const mockFile = {
        originalname: 'real-image.png',
        mimetype: 'image/png',
        buffer: Buffer.from('mock-png-data'),
      } as any;

      const result = await pipe.transform(mockFile);
      expect(result).toBe(mockFile);
    });
  });
});
