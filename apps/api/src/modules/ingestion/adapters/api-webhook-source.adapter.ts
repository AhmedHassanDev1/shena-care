import {
  CanonicalSupplierEnvelope,
  SupplierSourceKind,
  SupplierDocumentKind,
  CanonicalPriceType,
} from '../contracts/canonical-supplier-record.contract';
import {
  SupplierSourceAdapter,
  CanonicalValidationResult,
  CanonicalNormalizationUtils,
} from './source-adapter.interface';
import { IngestionImportMode } from '@prisma/client';

export interface ApiWebhookPayload {
  eventId: string;
  timestamp: string;
  feedType?: 'price_update' | 'inventory_snapshot' | 'full_catalog';
  records: Array<{
    sku: string;
    brand: string;
    name: string;
    barcode?: string;
    cost: number;
    currency?: string;
    stock?: number | null;
    variant?: string;
    size?: string;
  }>;
}

export interface ApiWebhookOptions {
  supplierId: string;
}

export class ApiWebhookSourceAdapter implements SupplierSourceAdapter<ApiWebhookPayload, ApiWebhookOptions> {
  readonly sourceKind = SupplierSourceKind.API;

  async parseAndNormalize(
    payload: ApiWebhookPayload,
    options: ApiWebhookOptions,
  ): Promise<CanonicalSupplierEnvelope> {
    const observedAt = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const documentKind = payload.feedType === 'inventory_snapshot'
      ? SupplierDocumentKind.STOCK_FEED
      : SupplierDocumentKind.PRICE_LIST;

    const importMode = payload.feedType === 'full_catalog'
      ? IngestionImportMode.FULL_SNAPSHOT
      : IngestionImportMode.PARTIAL_UPDATE;

    const items = payload.records.map((rec, index) => {
      const rowNumber = index + 1;
      return {
        sourceRowNumber: rowNumber,
        supplierSkuCode: CanonicalNormalizationUtils.normalizeString(rec.sku),
        rawBrand: CanonicalNormalizationUtils.normalizeString(rec.brand),
        rawProductName: CanonicalNormalizationUtils.normalizeString(rec.name),
        rawSize: rec.size ? CanonicalNormalizationUtils.normalizeString(rec.size) : null,
        rawSizeUnit: null,
        rawVariantName: rec.variant ? CanonicalNormalizationUtils.normalizeString(rec.variant) : null,
        barcode: CanonicalNormalizationUtils.normalizeBarcode(rec.barcode),
        pricing: CanonicalNormalizationUtils.parsePricing(
          rec.cost,
          rec.currency || 'EGP',
          CanonicalPriceType.PURCHASE_COST,
        ),
        inventory: CanonicalNormalizationUtils.parseQuantity(rec.stock),
        provenance: {
          sourceId: payload.eventId,
          sourceRow: rowNumber,
          observedAt,
          rawPayload: rec as Record<string, unknown>,
        },
      };
    });

    return {
      envelopeVersion: 'v1',
      supplierId: options.supplierId,
      sourceKind: this.sourceKind,
      documentKind,
      importMode,
      sourceId: payload.eventId,
      observedAt,
      items,
    };
  }

  validateEnvelope(envelope: CanonicalSupplierEnvelope): CanonicalValidationResult {
    const errors = envelope.items.filter((i) => !i.supplierSkuCode || !i.rawBrand || !i.rawProductName || i.pricing.amount <= 0);
    return {
      isValid: errors.length === 0,
      issues: errors.map((i) => ({
        rowNumber: i.sourceRowNumber,
        field: 'record',
        issue: 'Incomplete webhook record',
        severity: 'ERROR',
      })),
      validRecordCount: envelope.items.length - errors.length,
      invalidRecordCount: errors.length,
    };
  }
}
