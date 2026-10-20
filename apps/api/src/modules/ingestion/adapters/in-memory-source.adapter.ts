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

export interface InMemoryRawRecord {
  supplierSkuCode?: unknown;
  rawBrand?: unknown;
  rawProductName?: unknown;
  rawSize?: unknown;
  rawSizeUnit?: unknown;
  rawVariantName?: unknown;
  barcode?: unknown;
  price?: unknown;
  currency?: unknown;
  priceType?: unknown;
  quantity?: unknown;
  attributes?: Record<string, unknown>;
}

export interface InMemoryAdapterOptions {
  supplierId: string;
  sourceId: string;
  documentKind?: SupplierDocumentKind;
  importMode?: IngestionImportMode;
  defaultPriceType?: CanonicalPriceType;
  defaultCurrency?: string;
}

export class InMemorySourceAdapter implements SupplierSourceAdapter<InMemoryRawRecord[], InMemoryAdapterOptions> {
  readonly sourceKind = SupplierSourceKind.MANUAL;

  async parseAndNormalize(
    rawRows: InMemoryRawRecord[],
    options: InMemoryAdapterOptions,
  ): Promise<CanonicalSupplierEnvelope> {
    const observedAt = new Date();
    const documentKind = options.documentKind || SupplierDocumentKind.PRICE_LIST;
    const importMode = options.importMode || IngestionImportMode.PARTIAL_UPDATE;

    const items: CanonicalSupplierRecord[] = rawRows.map((row, index) => {
      const rowNumber = index + 1;
      const skuCode = CanonicalNormalizationUtils.normalizeString(row.supplierSkuCode);
      const brand = CanonicalNormalizationUtils.normalizeString(row.rawBrand);
      const name = CanonicalNormalizationUtils.normalizeString(row.rawProductName);
      const barcode = CanonicalNormalizationUtils.normalizeBarcode(row.barcode);

      const priceType = row.priceType === 'RETAIL_REFERENCE'
        ? CanonicalPriceType.RETAIL_REFERENCE
        : (options.defaultPriceType || CanonicalPriceType.PURCHASE_COST);

      const pricing = CanonicalNormalizationUtils.parsePricing(
        row.price,
        row.currency || options.defaultCurrency || 'EGP',
        priceType,
      );

      const inventory = CanonicalNormalizationUtils.parseQuantity(row.quantity);

      return {
        sourceRowNumber: rowNumber,
        supplierSkuCode: skuCode,
        rawBrand: brand,
        rawProductName: name,
        rawSize: row.rawSize ? String(row.rawSize) : null,
        rawSizeUnit: row.rawSizeUnit ? String(row.rawSizeUnit) : null,
        rawVariantName: row.rawVariantName ? String(row.rawVariantName) : null,
        barcode,
        pricing,
        inventory,
        rawAttributes: (row.attributes as Record<string, string | number | boolean | null>) || undefined,
        provenance: {
          sourceId: options.sourceId,
          sourceRow: rowNumber,
          observedAt,
          rawPayload: row as Record<string, unknown>,
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
