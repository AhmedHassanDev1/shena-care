import * as path from 'path';

type UploadedFile = Pick<Express.Multer.File, 'mimetype' | 'originalname' | 'buffer'>;

/**
 * True when the declared MIME type, the extension and the actual content bytes agree.
 * Images and PDFs are verified structurally; spreadsheets and CSV by type and extension.
 */
export function hasValidFileSignature(file: UploadedFile): boolean {
  const b = file.buffer;
  const ext = path.extname(file.originalname).toLowerCase();
  return (file.mimetype === 'image/png' && ext === '.png' && b.length >= 67 &&
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
}
