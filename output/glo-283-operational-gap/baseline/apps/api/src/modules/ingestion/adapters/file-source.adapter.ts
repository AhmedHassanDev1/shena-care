import {
  CanonicalSupplierEnvelope,
  CanonicalSupplierRecord,
  SupplierSourceKind,
  SupplierDocumentKind,
  CanonicalPriceType,
} from '../contracts/canonical-supplier-record.contract';
import {
  SupplierSourceAdapter,
  CanonicalValidationResult,
  CanonicalValidationIssue,
  CanonicalNormalizationUtils,
} from './source-adapter.interface';
import { IngestionImportMode } from '@prisma/client';
import * as crypto from 'crypto';

export interface FileColumnMapping {
  skuCodeColumn: string;
  brandColumn: string;
  productNameColumn: string;
  barcodeColumn?: string;
  sizeColumn?: string;
  sizeUnitColumn?: string;
  variantColumn?: string;
  priceColumn: string;
  currencyColumn?: string;
  priceTypeColumn?: string;
  quantityColumn?: string;
}

export interface FileAdapterOptions {
  supplierId: string;
  sourceId: string;
  sourceFileName?: string;
  mapping: FileColumnMapping;
  documentKind?: SupplierDocumentKind;
  importMode?: IngestionImportMode;
  defaultPriceType?: CanonicalPriceType;
  defaultCurrency?: string;
  hasHeaderRow?: boolean;
}

export class FileSourceAdapter implements SupplierSourceAdapter<string | Buffer, FileAdapterOptions> {
  readonly sourceKind = SupplierSourceKind.FILE;

  /**
   * Parses CSV / delimited text cleanly, respecting quotes and line breaks.
   */
  private parseCsvRows(content: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let insideQuotes = false;

    // Normalize CRLF to LF
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i];
      const nextChar = normalized[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n' && !insideQuotes) {
        currentRow.push(currentField);
        if (currentRow.some((f) => f.trim().length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField);
      if (currentRow.some((f) => f.trim().length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  async parseAndNormalize(
    input: string | Buffer,
    options: FileAdapterOptions,
  ): Promise<CanonicalSupplierEnvelope> {
    const rawText = Buffer.isBuffer(input) ? input.toString('utf-8') : input;
    const checksum = crypto.createHash('sha256').update(rawText).digest('hex');
    const observedAt = new Date();
    const documentKind = options.documentKind || SupplierDocumentKind.PRICE_LIST;
    const importMode = options.importMode || IngestionImportMode.PARTIAL_UPDATE;

    const parsedRows = this.parseCsvRows(rawText);
    if (!parsedRows.length) {
      return {
        envelopeVersion: 'v1',
        supplierId: options.supplierId,
        sourceKind: this.sourceKind,
        documentKind,
        importMode,
        sourceId: options.sourceId,
        sourceChecksum: checksum,
        observedAt,
        items: [],
      };
    }

    const hasHeader = options.hasHeaderRow !== false;
    const headerRow = hasHeader ? parsedRows[0].map((h) => h.trim().toLowerCase()) : [];
    const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;

    const getColIndex = (colName?: string): number => {
      if (!colName) return -1;
      const lower = colName.trim().toLowerCase();
      // Try exact header match
      const exact = headerRow.indexOf(lower);
      if (exact !== -1) return exact;
      // Try numeric column index
      const num = parseInt(colName, 10);
      return !isNaN(num) && num >= 0 ? num : -1;
    };

    const skuIdx = getColIndex(options.mapping.skuCodeColumn);
    const brandIdx = getColIndex(options.mapping.brandColumn);
    const nameIdx = getColIndex(options.mapping.productNameColumn);
    const barcodeIdx = getColIndex(options.mapping.barcodeColumn);
    const sizeIdx = getColIndex(options.mapping.sizeColumn);
    const unitIdx = getColIndex(options.mapping.sizeUnitColumn);
    const variantIdx = getColIndex(options.mapping.variantColumn);
    const priceIdx = getColIndex(options.mapping.priceColumn);
    const currIdx = getColIndex(options.mapping.currencyColumn);
    const pTypeIdx = getColIndex(options.mapping.priceTypeColumn);
    const qtyIdx = getColIndex(options.mapping.quantityColumn);

    const items: CanonicalSupplierRecord[] = dataRows.map((cols, index) => {
      const rowNumber = (hasHeader ? 2 : 1) + index;
      const rawSku = skuIdx >= 0 ? cols[skuIdx] : '';
      const rawBrand = brandIdx >= 0 ? cols[brandIdx] : '';
      const rawName = nameIdx >= 0 ? cols[nameIdx] : '';
      const rawBarcode = barcodeIdx >= 0 ? cols[barcodeIdx] : null;
      const rawSize = sizeIdx >= 0 ? cols[sizeIdx] : null;
      const rawUnit = unitIdx >= 0 ? cols[unitIdx] : null;
      const rawVariant = variantIdx >= 0 ? cols[variantIdx] : null;
      const rawPrice = priceIdx >= 0 ? cols[priceIdx] : null;
      const rawCurr = currIdx >= 0 ? cols[currIdx] : (options.defaultCurrency || '');
      const rawPriceType = pTypeIdx >= 0 ? cols[pTypeIdx] : undefined;
      const rawQty = qtyIdx >= 0 ? cols[qtyIdx] : undefined;

      const priceType = rawPriceType && /retail/i.test(String(rawPriceType))
        ? CanonicalPriceType.RETAIL_REFERENCE
        : rawPriceType && /cost|purchase/i.test(String(rawPriceType))
        ? CanonicalPriceType.PURCHASE_COST
        : (options.defaultPriceType || CanonicalPriceType.UNCLASSIFIED);

      const pricing = CanonicalNormalizationUtils.parsePricing(
        rawPrice,
        rawCurr,
        priceType,
      );

      const inventory = CanonicalNormalizationUtils.parseQuantity(rawQty);

      return {
        sourceRowNumber: rowNumber,
        supplierSkuCode: CanonicalNormalizationUtils.normalizeString(rawSku),
        rawBrand: CanonicalNormalizationUtils.normalizeString(rawBrand),
        rawProductName: CanonicalNormalizationUtils.normalizeString(rawName),
        rawSize: rawSize ? CanonicalNormalizationUtils.normalizeString(rawSize) : null,
        rawSizeUnit: rawUnit ? CanonicalNormalizationUtils.normalizeString(rawUnit) : null,
        rawVariantName: rawVariant ? CanonicalNormalizationUtils.normalizeString(rawVariant) : null,
        barcode: CanonicalNormalizationUtils.normalizeBarcode(rawBarcode),
        pricing,
        inventory,
        provenance: {
          sourceId: options.sourceId,
          sourceRow: rowNumber,
          observedAt,
          rawPayload: { row: cols },
        },
      };
    });

    return {
      envelopeVersion: 'v1',
      supplierId: options.supplierId,
      sourceKind: this.sourceKind,
      documentKind,
      importMode,
      sourceId: options.sourceId,
      sourceChecksum: checksum,
      observedAt,
      items,
    };
  }

  validateEnvelope(envelope: CanonicalSupplierEnvelope): CanonicalValidationResult {
    const issues: CanonicalValidationIssue[] = [];

    envelope.items.forEach((item) => {
      if (!item.supplierSkuCode) {
        issues.push({
          rowNumber: item.sourceRowNumber,
          field: 'supplierSkuCode',
          issue: 'Missing supplier SKU code',
          severity: 'ERROR',
        });
      }
      if (!item.rawBrand) {
        issues.push({
          rowNumber: item.sourceRowNumber,
          field: 'rawBrand',
          issue: 'Missing brand name',
          severity: 'ERROR',
        });
      }
      if (!item.rawProductName) {
        issues.push({
          rowNumber: item.sourceRowNumber,
          field: 'rawProductName',
          issue: 'Missing product name',
          severity: 'ERROR',
        });
      }
      if (item.pricing.amount <= 0) {
        issues.push({
          rowNumber: item.sourceRowNumber,
          field: 'pricing.amount',
          issue: 'Price must be greater than zero',
          severity: 'ERROR',
        });
      }
      if (!item.pricing.currency || item.pricing.currency.length !== 3) {
        issues.push({
          rowNumber: item.sourceRowNumber,
          field: 'pricing.currency',
          issue: 'Missing or invalid 3-letter currency code',
          severity: 'ERROR',
        });
      }
      if (item.inventory.presence === 'EXPLICIT' && (item.inventory.quantity === null || item.inventory.quantity < 0)) {
        issues.push({
          rowNumber: item.sourceRowNumber,
          field: 'inventory.quantity',
          issue: 'Invalid quantity for EXPLICIT presence',
          severity: 'ERROR',
        });
      }
    });

    const errorCount = issues.filter((i) => i.severity === 'ERROR').length;
    return {
      isValid: errorCount === 0,
      issues,
      validRecordCount: envelope.items.length - errorCount,
      invalidRecordCount: errorCount,
    };
  }
}
