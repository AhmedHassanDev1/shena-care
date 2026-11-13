import { IntakeRowOutcome } from '@prisma/client';
import { NewIntakeRow } from '../services/intake-store.service';
import { identityFingerprint, normalizeCell, parseAmount, parseBarcode, parsePercent, parseQuantity, readMeasures } from './intake-text';
import { cellOf, ColumnMap, IntakeField, ParsedSheet } from './spreadsheet';

export interface ColumnProblem { code: string; message: string }

/** What a supplier file must let us read: a product name and a purchase price (stated, or consumer price with a stated discount). */
export function supplierColumnProblems(map: ColumnMap): ColumnProblem[] {
  const problems: ColumnProblem[] = [];
  if (map.name === undefined) problems.push({ code: 'NAME_COLUMN_MISSING', message: 'No product name column was found' });
  const purchase = map.purchasePrice !== undefined || (map.consumerPrice !== undefined && map.discountPercent !== undefined);
  if (!purchase) {
    problems.push(map.price !== undefined
      ? { code: 'PRICE_TYPE_AMBIGUOUS', message: 'The file has one "price" column; say whether it is the purchase price or the consumer price' }
      : { code: 'PURCHASE_PRICE_COLUMN_MISSING', message: 'No purchase price column was found (or consumer price with a discount column)' });
  }
  return problems;
}

const cells = (row: { cells: string[] }, map: ColumnMap) => Object.fromEntries((Object.keys(map) as IntakeField[]).map(field => [field, cellOf(row, map, field)]).filter(([, value]) => value));

/**
 * Supplier rows: cheap parse and dedupe, with a row audit. Invalid when the name is missing, the purchase price is missing or not positive, or the consumer price is
 * below the purchase price. Identical repeated lines keep the first; repeats with different prices are all invalid (the file contradicts itself).
 */
export function readSupplierRows(sheet: ParsedSheet): NewIntakeRow[] {
  const map = sheet.columnMap;
  const rows: NewIntakeRow[] = sheet.rows.map(row => {
    const name = cellOf(row, map, 'name');
    const reading = readMeasures(`${name} ${cellOf(row, map, 'size')}`);
    const consumer = parseAmount(cellOf(row, map, 'consumerPrice'));
    const discount = parsePercent(cellOf(row, map, 'discountPercent'));
    const statedPurchase = parseAmount(cellOf(row, map, 'purchasePrice'));
    const derived = statedPurchase === null && consumer !== null && discount !== null ? Math.round(consumer * (1 - discount / 100) * 100) / 100 : null;
    const purchase = statedPurchase ?? derived;
    const barcode = parseBarcode(cellOf(row, map, 'barcode'));
    const measure = reading.measures.length === 1 ? reading.measures[0] : null;
    const base: NewIntakeRow = {
      rowNumber: row.line, rawName: name, sourceCells: cells(row, map), normalizedName: normalizeCell(name),
      fingerprint: name ? identityFingerprint(`${cellOf(row, map, 'brand')} ${name}`, measure, reading.packCount) : null,
      supplierCode: cellOf(row, map, 'code') || null, barcode, purchasePrice: purchase, consumerPrice: consumer, currency: 'EGP',
      quantity: parseQuantity(cellOf(row, map, 'quantity')),
      parsed: { brandCell: cellOf(row, map, 'brand') || null, measures: reading.measures, packCount: reading.packCount, purchaseBasis: statedPurchase !== null ? 'STATED' : derived !== null ? 'CONSUMER_LESS_DISCOUNT' : null,
        discountPercent: discount, invalidBarcode: cellOf(row, map, 'barcode') && !barcode ? cellOf(row, map, 'barcode') : null },
    };
    const invalid = (reasonCode: string, reason: string): NewIntakeRow => ({ ...base, outcome: IntakeRowOutcome.INVALID, reasonCode, reason });
    if (!name || name.length < 3) return invalid('NAME_MISSING', 'The product name is empty');
    if (name.length > 300) return invalid('NAME_TOO_LONG', 'The product name is longer than 300 characters');
    if (cellOf(row, map, 'barcode') && !barcode) return invalid('INVALID_BARCODE', 'The stated barcode is not a valid GS1 GTIN; correct it before matching');
    if (purchase === null) return invalid('PURCHASE_PRICE_MISSING', cellOf(row, map, 'purchasePrice') ? `"${cellOf(row, map, 'purchasePrice')}" is not a price` : 'No purchase price');
    if (purchase <= 0) return invalid('PURCHASE_PRICE_NOT_POSITIVE', 'The purchase price must be above zero');
    if (consumer !== null && consumer < purchase) return invalid('CONSUMER_BELOW_PURCHASE', `Consumer price ${consumer} is below purchase price ${purchase}`);
    return base;
  });
  return dedupe(rows, row => `${row.fingerprint}|${(row.supplierCode ?? '').toLowerCase()}|${row.barcode ?? ''}`, row => `${row.purchasePrice}|${row.consumerPrice}`);
}

/** Admin rows: names (with optional brand, size, barcode, page). Duplicate names in one submission are processed once. */
export function readAdminRows(sheet: ParsedSheet): NewIntakeRow[] {
  const map = sheet.columnMap;
  const rows: NewIntakeRow[] = sheet.rows.map(row => {
    const name = cellOf(row, map, 'name');
    const brand = cellOf(row, map, 'brand');
    const reading = readMeasures(`${name} ${cellOf(row, map, 'size')}`);
    const measure = reading.measures.length === 1 ? reading.measures[0] : null;
    const url = cellOf(row, map, 'url');
    const base: NewIntakeRow = {
      rowNumber: row.line, rawName: name, sourceCells: cells(row, map), normalizedName: normalizeCell(name),
      fingerprint: name ? identityFingerprint(`${brand} ${name}`, measure, reading.packCount) : null, barcode: parseBarcode(cellOf(row, map, 'barcode')),
      parsed: { brandCell: brand || null, measures: reading.measures, packCount: reading.packCount, url: /^https:\/\//i.test(url) ? url : null, categoryCell: cellOf(row, map, 'category') || null },
    };
    if (!name || name.length < 3) return { ...base, outcome: IntakeRowOutcome.INVALID, reasonCode: 'NAME_MISSING', reason: 'The product name is empty' };
    if (name.length > 200) return { ...base, outcome: IntakeRowOutcome.INVALID, reasonCode: 'NAME_TOO_LONG', reason: 'The product name is longer than 200 characters' };
    if (cellOf(row, map, 'barcode') && !base.barcode) return { ...base, outcome: IntakeRowOutcome.INVALID, reasonCode: 'INVALID_BARCODE', reason: 'The stated barcode is not a valid GS1 GTIN; correct it before matching' };
    if (reading.measures.length > 1) return { ...base, outcome: IntakeRowOutcome.INVALID, reasonCode: 'SEVERAL_SIZES', reason: 'The name states more than one size; submit one line per size' };
    return base;
  });
  return dedupe(rows, row => row.fingerprint ?? row.rawName, () => '');
}

function dedupe(rows: NewIntakeRow[], key: (row: NewIntakeRow) => string, payload: (row: NewIntakeRow) => string): NewIntakeRow[] {
  const groups = new Map<string, NewIntakeRow[]>();
  for (const row of rows) if (!row.outcome) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const payloads = new Set(group.map(payload));
    group.forEach((row, index) => {
      if (payloads.size > 1) {
        row.outcome = IntakeRowOutcome.INVALID; row.reasonCode = 'CONFLICTING_DUPLICATE';
        row.reason = `Lines ${group.map(item => item.rowNumber).join(', ')} name the same product with different prices`;
      } else if (index > 0) {
        row.outcome = IntakeRowOutcome.SKIPPED; row.reasonCode = 'DUPLICATE_ROW'; row.reason = `Same as line ${group[0].rowNumber}`;
      }
    });
  }
  return rows;
}

/** Admin names typed or pasted: one per line, optional "brand | name" form is not needed; blank lines dropped. */
export function namesToSheet(text: string | string[]): ParsedSheet {
  const lines = (Array.isArray(text) ? text : text.split(/\r?\n/)).map(line => normalizeCell(line)).filter(Boolean);
  return { headers: ['name'], headerRow: 0, columnMap: { name: 0 }, ignored: [], ambiguous: [], sheetName: null, rows: lines.map((line, index) => ({ line: index + 1, cells: [line] })) };
}
