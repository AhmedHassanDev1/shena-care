import * as XLSX from 'xlsx';
import { foldIdentityText } from '../../catalog/public';
import { normalizeCell } from './intake-text';

/** The fields an intake file can carry. Admin files need only `name`; supplier files need `name` and a purchase price (stated or derivable). */
export type IntakeField = 'name' | 'brand' | 'purchasePrice' | 'consumerPrice' | 'discountPercent' | 'price' | 'code' | 'barcode' | 'quantity' | 'size' | 'category' | 'url';
export type ColumnMap = Partial<Record<IntakeField, number>>;

export interface ParsedSheet {
  headers: string[];
  headerRow: number;
  /** Data rows with their 1-indexed line number in the original sheet. */
  rows: Array<{ line: number; cells: string[] }>;
  columnMap: ColumnMap;
  /** Headers no field recognised; kept for the audit trail. */
  ignored: string[];
  /** Headers more than one field could have claimed; the first reading was kept. */
  ambiguous: string[];
  sheetName: string | null;
}

// Header wording seen in Egyptian pharmacy and distributor price lists, Arabic and English. Order matters: specific phrases before generic ones.
const HEADER_RULES: Array<[IntakeField, RegExp]> = [
  ['consumerPrice', /(سعر\s*(ال)?(مستهلك|جمهور|البيع\s*للجمهور|البيع\s*للمستهلك|الجمهور)|^(ال)?(مستهلك|جمهور)$|consumer|retail|rrp|public\s*price|msrp|selling\s*price\s*to\s*public)/u],
  ['purchasePrice', /(سعر\s*(ال)?(شراء|جمله|تكلفه|صيدلي|صيدليه|توريد|الصيدلي|الصيدليه)|(ال)?تكلفه|^(ال)?صافي$|صافي\s*السعر|cost|purchase|wholesale|net\s*price|trade\s*price|pharmacy\s*price|buying)/u],
  ['discountPercent', /(خصم|نسبه\s*الخصم|discount|disc\s*%)/u],
  ['barcode', /(باركود|بار\s*كود|barcode|ean|gtin|upc)/u],
  ['code', /(^(ال)?كود|كود\s*(ال)?صنف|رقم\s*(ال)?صنف|item\s*code|sku|^code$|product\s*code|ref)/u],
  ['quantity', /(كميه|الكميه|رصيد|الرصيد|متاح|المتاح|qty|quantity|stock|available|balance)/u],
  ['brand', /(ماركه|براند|(ال)?شركه|(ال)?مصنع|brand|manufacturer|company|vendor)/u],
  ['size', /(^(ال)?حجم|^(ال)?عبوه|size|volume|pack\s*size)/u],
  ['category', /(^(ال)?قسم|(ال)?فئه|^(ال)?تصنيف|category|department)/u],
  ['url', /(رابط|لينك|url|link|website)/u],
  ['name', /(اسم\s*(ال)?(صنف|منتج|دواء)|^(ال)?صنف$|^(ال)?منتج$|^(ال)?بيان$|^(ال)?اسم$|^(ال)?وصف$|product|item|name|description|title)/u],
  ['price', /(^(ال)?سعر$|^price$|unit\s*price|^سعر\s*(ال)?وحده$|^سعر\s*(ال)?بيع$)/u],
];

const headerKey = (value: string) => foldIdentityText(normalizeCell(value)).replace(/[_\-.]+/g, ' ').replace(/[^\p{L}\p{N}%\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

export function detectColumns(headers: string[]): { map: ColumnMap; ignored: string[]; ambiguous: string[] } {
  const map: ColumnMap = {};
  const ignored: string[] = [];
  const ambiguous: string[] = [];
  headers.forEach((header, index) => {
    const key = headerKey(header);
    if (!key) return;
    const fields = HEADER_RULES.filter(([, pattern]) => pattern.test(key)).map(([field]) => field);
    const free = fields.find(field => map[field] === undefined);
    if (!free) { ignored.push(header); return; }
    if (fields.length > 1) ambiguous.push(header);
    map[free] = index;
  });
  return { map, ignored, ambiguous };
}

const isTextFile = (fileName: string, mimeType: string) => /\.(csv|tsv|txt)$/i.test(fileName) || /^text\//.test(mimeType) || mimeType === 'application/csv';

function decodeText(buffer: Buffer): string {
  const text = buffer.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function delimiterOf(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts: Array<[string, number]> = [[',', 0], [';', 0], ['\t', 0], ['|', 0]].map(([d]) => [d as string, firstLines.split(d as string).length - 1]);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ',';
}

/**
 * Reads the first sheet that has a recognisable header (within its first 15 lines). Cells are read as displayed text, so barcodes keep their leading zeros
 * and prices keep what the supplier typed; numbers are parsed later by the row reader.
 */
export function parseSpreadsheet(buffer: Buffer, fileName: string, mimeType: string, override?: ColumnMap): ParsedSheet {
  const workbook = isTextFile(fileName, mimeType)
    ? (() => { const text = decodeText(buffer); return XLSX.read(text, { type: 'string', FS: delimiterOf(text), raw: true, dense: true }); })()
    : XLSX.read(buffer, { type: 'buffer', cellDates: false, dense: true });
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true }) as unknown[][];
    for (let headerIndex = 0; headerIndex < Math.min(15, matrix.length); headerIndex++) {
      const headers = (matrix[headerIndex] ?? []).map(cell => normalizeCell(cell));
      const detected = detectColumns(headers);
      const map = { ...detected.map, ...(override ?? {}) };
      if (map.name === undefined) continue;
      // A header row names at least one more field than the product name, unless the file is a bare list of names.
      if (Object.keys(detected.map).length < 2 && headers.filter(Boolean).length > 1 && !override) continue;
      const rows = matrix.slice(headerIndex + 1).map((cells, offset) => ({ line: headerIndex + offset + 2, cells: (cells ?? []).map(cell => normalizeCell(cell)) }))
        .filter(row => row.cells.some(Boolean));
      return { headers, headerRow: headerIndex + 1, rows, columnMap: map, ignored: detected.ignored, ambiguous: detected.ambiguous, sheetName };
    }
  }
  // No header at all: a one-column list of names (Admin).
  const first = workbook.SheetNames[0];
  const matrix = first ? XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[first], { header: 1, raw: false, defval: '' }) as unknown[][] : [];
  const single = matrix.every(row => (row ?? []).filter(cell => normalizeCell(cell)).length <= 1);
  if (single && matrix.length) {
    return { headers: [], headerRow: 0, columnMap: { name: 0 }, ignored: [], ambiguous: [], sheetName: first ?? null,
      rows: matrix.map((cells, index) => ({ line: index + 1, cells: [normalizeCell((cells ?? []).find(cell => normalizeCell(cell)) ?? '')] })).filter(row => row.cells[0]) };
  }
  return { headers: [], headerRow: 0, rows: [], columnMap: {}, ignored: [], ambiguous: [], sheetName: first ?? null };
}

export function cellOf(row: { cells: string[] }, map: ColumnMap, field: IntakeField): string {
  const index = map[field];
  return index === undefined ? '' : row.cells[index] ?? '';
}
