// GLO-273 Gate 01 — bounded, non-truncating handling of untrusted supplier files (no database needed).
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { SpreadsheetParserService } from '../../src/modules/ingestion/services/spreadsheet-parser.service';
import { hasValidFileSignature } from '../../src/platform/security/file-signature';

const parser = new SpreadsheetParserService();

function xlsxBuffer(rows: unknown[][], props?: XLSX.FullProperties): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Items');
  if (props) wb.Props = props;
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Offsets of every central-directory header plus the end-of-central-directory record. */
function zipDirectory(buffer: Buffer): { eocd: number; headers: number[] } {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  const headers: number[] = [];
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < buffer.readUInt16LE(eocd + 10); n++) {
    headers.push(offset);
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return { eocd, headers };
}

const header = ['Supplier SKU', 'Product Name', 'Buy Cost', 'Qty'];
const sample = [header, ['A-1', 'CeraVe Cleanser 236ml', 100, 5]];

describe('GLO-273 Gate 01: source file safety', () => {
  it('parses a genuine small XLSX and records advisory workbook timestamps', () => {
    const created = new Date('2026-10-01T08:00:00Z');
    const parsed = parser.parseSpreadsheet(xlsxBuffer(sample, { CreatedDate: created }), 'export.xlsx');
    expect(parsed.totalDataRows).toBe(1);
    expect(parsed.workbookProps?.createdAt).toBe(created.toISOString());
  });

  it('records no workbook timestamps for CSV (none exist in the format)', () => {
    const parsed = parser.parseSpreadsheet(Buffer.from('Supplier SKU,Product Name,Buy Cost\nA-1,Cream,10\n'), 'export.csv');
    expect(parsed.workbookProps).toBeUndefined();
  });

  it('rejects an archive whose declared expansion exceeds the bound (zip bomb) before inflating', () => {
    const bomb = Buffer.from(xlsxBuffer(sample));
    const { headers } = zipDirectory(bomb);
    bomb.writeUInt32LE(160 * 1024 * 1024, headers[0] + 24);
    expect(() => parser.parseSpreadsheet(bomb, 'bomb.xlsx')).toThrow(/expands beyond/);
  });

  it('rejects encrypted entries, ZIP64 markers, excessive entry counts and broken directories', () => {
    const base = xlsxBuffer(sample);
    const encrypted = Buffer.from(base);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(zipDirectory(encrypted).headers[0] + 8) | 0x1, zipDirectory(encrypted).headers[0] + 8);
    expect(() => parser.parseSpreadsheet(encrypted, 'locked.xlsx')).toThrow(/password-protected/);

    const zip64 = Buffer.from(base);
    zip64.writeUInt32LE(0xffffffff, zipDirectory(zip64).headers[0] + 24);
    expect(() => parser.parseSpreadsheet(zip64, 'zip64.xlsx')).toThrow(/ZIP64/);

    const crowded = Buffer.from(base);
    crowded.writeUInt16LE(1001, zipDirectory(crowded).eocd + 10);
    expect(() => parser.parseSpreadsheet(crowded, 'crowded.xlsx')).toThrow(/too many parts/);

    const truncated = Buffer.from(base);
    truncated.writeUInt32LE(0, zipDirectory(truncated).headers[0]);
    expect(() => parser.parseSpreadsheet(truncated, 'truncated.xlsx')).toThrow(BadRequestException);
  });

  it('rejects an XLSX that exceeds the row limit instead of silently truncating it', () => {
    const rows = [header, ...Array.from({ length: 120 }, (_, i) => [`A-${i}`, `Cream ${i}`, 10, 1])];
    expect(() => parser.parseSpreadsheet(xlsxBuffer(rows), 'big.xlsx', { maxRows: 50 })).toThrow(/rows limit/);
    expect(() => parser.parseSpreadsheet(Buffer.from(rows.map(r => r.join(',')).join('\n')), 'big.csv', { maxRows: 50 }))
      .toThrow(/rows limit/);
  });

  it('rejects an XLSX that exceeds the column limit', () => {
    const wide = [Array.from({ length: 12 }, (_, i) => `Col ${i}`), Array.from({ length: 12 }, () => 'x')];
    expect(() => parser.parseSpreadsheet(xlsxBuffer(wide), 'wide.xlsx', { maxColumns: 10 })).toThrow(/columns limit/);
  });

  it('rejects encrypted Office (OLE) files and executables disguised as spreadsheets', () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(() => parser.parseSpreadsheet(ole, 'encrypted.xlsx')).toThrow(/invalid archive signature/);
    expect(() => parser.parseSpreadsheet(Buffer.from('MZ\x90\x00binary'), 'prices.csv')).toThrow(/Executable/);
    expect(() => parser.parseSpreadsheet(Buffer.alloc(0), 'empty.csv')).toThrow(/Empty/);
  });

  it('accepts only matching declared MIME type and extension at the transport boundary', () => {
    const csv = Buffer.from('a,b\n1,2\n');
    expect(hasValidFileSignature({ mimetype: 'text/csv', originalname: 'p.csv', buffer: csv })).toBe(true);
    expect(hasValidFileSignature({ mimetype: 'text/csv', originalname: 'p.exe', buffer: csv })).toBe(false);
    expect(hasValidFileSignature({ mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', originalname: 'p.csv', buffer: csv })).toBe(false);
  });
});
