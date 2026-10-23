import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

export interface ParsedSpreadsheetRow {
  sourceRow: number; // 1-indexed row number in the file
  data: Record<string, any>;
}

export interface ParsedSpreadsheet {
  sheets: string[];
  activeSheet: string;
  headerRowIndex: number; // 1-indexed
  headers: string[];
  sampleRows: Record<string, any>[];
  totalDataRows: number;
  rows: ParsedSpreadsheetRow[];
  /** Advisory workbook metadata (XLSX/XLS only); never trusted as business freshness. */
  workbookProps?: { createdAt: string | null; modifiedAt: string | null };
}

export interface ParseSpreadsheetOptions {
  maxFileSize?: number;
  maxSheets?: number;
  maxRows?: number;
  maxColumns?: number;
  sheetName?: string;
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_SHEETS = 20;
const DEFAULT_MAX_ROWS = 10000;
const DEFAULT_MAX_COLUMNS = 100;
// Zip-bomb bounds for XLSX archives, checked from the central directory before decompression.
// 10k rows x 100 columns of XML stays well below this; real supplier exports are a few MB.
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1000;
// Rows scanned for header discovery on top of the data-row limit.
const HEADER_SCAN_ROWS = 15;

// Known header cues for automated discovery in English and Arabic
const HEADER_KEYWORD_CUES = [
  'sku',
  'code',
  'item code',
  'barcode',
  'upc',
  'ean',
  'name',
  'product name',
  'title',
  'description',
  'price',
  'cost',
  'buy price',
  'retail',
  'qty',
  'quantity',
  'stock',
  'brand',
  'كود',
  'رمز',
  'رقم الصنف',
  'باركود',
  'اسم',
  'المنتج',
  'اسم المنتج',
  'سعر',
  'تكلفة',
  'سعر الشراء',
  'سعر البيع',
  'كمية',
  'المخزون',
  'الرصيد',
  'ماركة',
];

@Injectable()
export class SpreadsheetParserService {
  /**
   * Validates file bytes and sniffs file type for security.
   * Defends against corrupt files, disguised executables, and malformed content.
   */
  sniffAndValidateFile(buffer: Buffer, originalname: string): 'xlsx' | 'xls' | 'csv' {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Empty spreadsheet file received');
    }

    if (buffer.length > DEFAULT_MAX_FILE_SIZE) {
      throw new BadRequestException(`File exceeds maximum size limit of ${DEFAULT_MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    const ext = originalname.split('.').pop()?.toLowerCase() || '';

    // Check magic bytes
    // PK\x03\x04 (ZIP / XLSX)
    const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
    // OLE2 (Legacy XLS)
    const isOle2 =
      buffer.length >= 8 &&
      buffer[0] === 0xd0 &&
      buffer[1] === 0xcf &&
      buffer[2] === 0x11 &&
      buffer[3] === 0xe0 &&
      buffer[4] === 0xa1 &&
      buffer[5] === 0xb1 &&
      buffer[6] === 0x1a &&
      buffer[7] === 0xe1;

    // Disguised binaries: PE (MZ) or ELF
    if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
      throw new BadRequestException('Executable files are not permitted');
    }
    if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
      throw new BadRequestException('Binary files are not permitted');
    }

    if (ext === 'xlsx') {
      if (!isZip) {
        throw new BadRequestException('Malformed XLSX file: invalid archive signature');
      }
      this.assertBoundedArchive(buffer);
      return 'xlsx';
    }

    if (ext === 'xls') {
      if (!isOle2 && !isZip) {
        throw new BadRequestException('Malformed XLS file: invalid spreadsheet signature');
      }
      if (isZip) this.assertBoundedArchive(buffer);
      return 'xls';
    }

    // For CSV/TSV or others: ensure no null bytes (indicative of binary/corrupt file)
    const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
    if (sample.includes(0x00)) {
      throw new BadRequestException('Malformed or binary file: null bytes detected in text spreadsheet');
    }

    return 'csv';
  }

  /**
   * Reads the ZIP central directory (without inflating anything) and rejects archives whose declared
   * uncompressed size or entry count exceeds the bounds, plus ZIP64 and encrypted entries we never expect
   * from a supplier export. Declared sizes can lie; the row/column caps below remain the second line.
   */
  assertBoundedArchive(buffer: Buffer): void {
    const malformed = () => new BadRequestException('Malformed XLSX file: unreadable archive directory');
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw malformed();

    const entries = buffer.readUInt16LE(eocd + 10);
    const directoryOffset = buffer.readUInt32LE(eocd + 16);
    if (entries === 0xffff || directoryOffset === 0xffffffff) {
      throw new BadRequestException('Unsupported XLSX archive (ZIP64)');
    }
    if (entries > MAX_ARCHIVE_ENTRIES) {
      throw new BadRequestException(`XLSX archive contains too many parts (${entries})`);
    }

    let offset = directoryOffset;
    let declaredTotal = 0;
    for (let n = 0; n < entries; n++) {
      if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw malformed();
      const flags = buffer.readUInt16LE(offset + 8);
      const uncompressed = buffer.readUInt32LE(offset + 24);
      if (flags & 0x1) throw new BadRequestException('Encrypted or password-protected spreadsheets are not supported');
      if (uncompressed === 0xffffffff) throw new BadRequestException('Unsupported XLSX archive (ZIP64)');
      declaredTotal += uncompressed;
      if (declaredTotal > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        throw new BadRequestException('XLSX archive expands beyond the allowed size');
      }
      offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    }
  }

  /**
   * Sanitizes cell values to prevent CSV/Spreadsheet Formula Injection (CWE-1236).
   * Characters =, +, -, @, \t, \r at the beginning of formulas are neutralized.
   */
  sanitizeCellValue(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return '';

      // Check if purely a valid numeric literal (e.g. -5, +12.3)
      if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
        return trimmed;
      }

      // If it starts with dangerous formula symbols
      if (/^[=+\-@\t\r]/.test(trimmed)) {
        // Prepend single quote to neutralize formula execution in Excel/Calc
        return `'${trimmed}`;
      }

      return trimmed;
    }

    return String(value);
  }

  /**
   * Parses CSV or XLSX buffer safely with anti-DoS bounds and traceable coordinates.
   */
  parseSpreadsheet(
    buffer: Buffer,
    originalname: string,
    options: ParseSpreadsheetOptions = {},
  ): ParsedSpreadsheet {
    const fileType = this.sniffAndValidateFile(buffer, originalname);

    const maxSheets = options.maxSheets ?? DEFAULT_MAX_SHEETS;
    const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
    const maxCols = options.maxColumns ?? DEFAULT_MAX_COLUMNS;

    // sheetRows bounds parsing work; the true extent is still checked via !fullref below.
    const readOptions = { cellFormula: true, cellHTML: false, cellText: false, sheetRows: maxRows + HEADER_SCAN_ROWS + 1 };
    let workbook: XLSX.WorkBook;
    try {
      if (fileType === 'csv') {
        const textContent = buffer.toString('utf-8');
        workbook = XLSX.read(textContent, { ...readOptions, type: 'string' });
      } else {
        workbook = XLSX.read(buffer, { ...readOptions, type: 'buffer' });
      }
    } catch (err: any) {
      throw new BadRequestException(`Failed to parse spreadsheet file: ${err.message || 'Corrupt format'}`);
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new BadRequestException('Spreadsheet contains no sheets');
    }

    if (workbook.SheetNames.length > maxSheets) {
      throw new BadRequestException(`Spreadsheet contains ${workbook.SheetNames.length} sheets (maximum allowed: ${maxSheets})`);
    }

    const activeSheetName = options.sheetName && workbook.SheetNames.includes(options.sheetName)
      ? options.sheetName
      : workbook.SheetNames[0];

    const sheet = workbook.Sheets[activeSheetName];
    if (!sheet) {
      throw new BadRequestException(`Sheet "${activeSheetName}" not found in workbook`);
    }
    const fullRange = sheet['!fullref'] ?? sheet['!ref'];
    if (fullRange) {
      const extent = XLSX.utils.decode_range(fullRange);
      if (extent.e.r - extent.s.r + 1 > maxRows + HEADER_SCAN_ROWS) {
        throw new BadRequestException(`Spreadsheet exceeds maximum allowed rows limit of ${maxRows}`);
      }
      if (extent.e.c - extent.s.c + 1 > maxCols) {
        throw new BadRequestException(`Spreadsheet exceeds maximum allowed columns limit of ${maxCols}`);
      }
    }

    // Preserve formula expressions so formula injection sanitizer can neutralize them
    for (const key of Object.keys(sheet)) {
      if (!key.startsWith('!')) {
        const cell = sheet[key];
        if (cell && cell.f && (cell.v === undefined || cell.v === null || cell.v === '')) {
          cell.v = `=${cell.f}`;
          cell.t = 's';
        }
      }
    }

    // Convert sheet to array of row arrays
    const rawMatrix: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (!rawMatrix || rawMatrix.length === 0) {
      throw new BadRequestException('Spreadsheet is empty');
    }

    if (rawMatrix.length > maxRows) {
      throw new BadRequestException(`Spreadsheet exceeds maximum allowed rows limit of ${maxRows}`);
    }

    // Header discovery
    const headerDiscovery = this.discoverHeaderRow(rawMatrix);
    const headerRowIndex = headerDiscovery.headerRowIndex; // 0-based index in rawMatrix
    const rawHeaders = headerDiscovery.headers;

    if (rawHeaders.length > maxCols) {
      throw new BadRequestException(`Spreadsheet exceeds maximum allowed columns limit of ${maxCols}`);
    }

    // Disambiguate duplicate or blank headers
    const headers: string[] = [];
    const seenHeaders = new Map<string, number>();

    rawHeaders.forEach((h, colIdx) => {
      let headerName = String(h || '').trim();
      if (!headerName) {
        headerName = `Column_${colIdx + 1}`;
      }
      const count = seenHeaders.get(headerName) || 0;
      if (count > 0) {
        seenHeaders.set(headerName, count + 1);
        headers.push(`${headerName}_${count + 1}`);
      } else {
        seenHeaders.set(headerName, 1);
        headers.push(headerName);
      }
    });

    // Parse data rows
    const rows: ParsedSpreadsheetRow[] = [];
    for (let r = headerRowIndex + 1; r < rawMatrix.length; r++) {
      const rawRow = rawMatrix[r];
      if (!rawRow || !Array.isArray(rawRow)) continue;

      // Skip row if completely empty
      const hasContent = rawRow.some((cell) => cell !== '' && cell !== null && cell !== undefined);
      if (!hasContent) continue;

      const rowData: Record<string, any> = {};
      headers.forEach((header, colIdx) => {
        const rawVal = rawRow[colIdx];
        rowData[header] = this.sanitizeCellValue(rawVal);
      });

      rows.push({
        sourceRow: r + 1, // 1-indexed line in file
        data: rowData,
      });
    }

    const sampleRows = rows.slice(0, 5).map((r) => r.data);

    return {
      sheets: workbook.SheetNames,
      activeSheet: activeSheetName,
      headerRowIndex: headerRowIndex + 1, // 1-indexed
      headers,
      sampleRows,
      totalDataRows: rows.length,
      rows,
      workbookProps: fileType === 'csv' ? undefined : {
        createdAt: this.isoOrNull(workbook.Props?.CreatedDate),
        modifiedAt: this.isoOrNull(workbook.Props?.ModifiedDate),
      },
    };
  }

  private isoOrNull(value: unknown): string | null {
    const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
    return date && !isNaN(date.getTime()) ? date.toISOString() : null;
  }

  private normalizeCue(str: string): string {
    return String(str || '')
      .toLowerCase()
      .trim()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[\r\n\t_]+/g, ' ')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Discovers the header row by scanning the first 15 rows for header keyword cues or text patterns.
   */
  private discoverHeaderRow(rawMatrix: any[][]): { headerRowIndex: number; headers: string[] } {
    const scanLimit = Math.min(rawMatrix.length, 15);
    let bestRowIdx = 0;
    let highestScore = -1;

    for (let r = 0; r < scanLimit; r++) {
      const row = rawMatrix[r];
      if (!row || !Array.isArray(row)) continue;

      const nonBlankCells = row.filter((c) => c !== '' && c !== null && c !== undefined);
      if (nonBlankCells.length < 2) continue;

      let score = 0;
      let stringCellCount = 0;

      for (const cell of nonBlankCells) {
        if (typeof cell === 'string') {
          stringCellCount++;
          const norm = this.normalizeCue(cell);
          for (const cue of HEADER_KEYWORD_CUES) {
            const normCue = this.normalizeCue(cue);
            if (norm === normCue || norm.includes(normCue)) {
              score += 20;
              break;
            }
          }
        }
      }

      // Bonus if all non-blank cells in this row are strings (characteristic of headers vs data)
      if (stringCellCount === nonBlankCells.length) {
        score += 25;
      } else {
        score += stringCellCount * 2;
      }

      if (score > highestScore) {
        highestScore = score;
        bestRowIdx = r;
      }
    }

    const selectedRow = rawMatrix[bestRowIdx] || [];
    const headers = selectedRow.map((c) => (c !== null && c !== undefined ? String(c).trim() : ''));

    // Ensure we don't return an empty header set
    const validHeaders = headers.filter((h) => h.length > 0);
    if (validHeaders.length === 0) {
      throw new BadRequestException('Unable to detect a valid header row with column names');
    }

    return {
      headerRowIndex: bestRowIdx,
      headers,
    };
  }
}
