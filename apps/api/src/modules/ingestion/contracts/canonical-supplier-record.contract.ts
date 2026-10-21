import { IngestionImportMode } from '@prisma/client';

export enum SupplierSourceKind {
  FILE = 'FILE',
  API = 'API',
  MANUAL = 'MANUAL',
}

export enum SupplierDocumentKind {
  PRICE_LIST = 'PRICE_LIST',
  STOCK_FEED = 'STOCK_FEED',
  SALES_INVOICE = 'SALES_INVOICE',
}

export enum QuantityPresence {
  EXPLICIT = 'EXPLICIT',
  ZERO = 'ZERO',
  UNKNOWN = 'UNKNOWN',
  MISSING = 'MISSING',
}

export enum CanonicalPriceType {
  PURCHASE_COST = 'PURCHASE_COST',
  RETAIL_REFERENCE = 'RETAIL_REFERENCE',
  UNCLASSIFIED = 'UNCLASSIFIED',
}

export interface CanonicalPricing {
  amount: number;
  currency: string;
  priceType: CanonicalPriceType;
  isTaxInclusive?: boolean;
  rawInput?: string | null;
}

export interface CanonicalInventory {
  presence: QuantityPresence;
  quantity: number | null;
  rawInput?: string | null;
}

export interface RecordProvenance {
  sourceId: string;
  sourceRow: number;
  observedAt: Date;
  rawPayload?: Record<string, unknown>;
}

export interface CanonicalSupplierRecord {
  sourceRowNumber: number;
  supplierSkuCode: string;
  rawBrand: string;
  rawProductName: string;
  rawSize?: string | null;
  rawSizeUnit?: string | null;
  rawVariantName?: string | null;
  barcode?: string | null;
  pricing: CanonicalPricing;
  inventory: CanonicalInventory;
  rawAttributes?: Record<string, string | number | boolean | null>;
  provenance: RecordProvenance;
}

export interface AssortmentCoverage {
  brandSlugs?: string[];
  categorySlugs?: string[];
  isFullCatalog: boolean;
  declaredItemCount?: number;
}

export interface CanonicalSupplierEnvelope {
  envelopeVersion: 'v1';
  supplierId: string;
  sourceKind: SupplierSourceKind;
  documentKind: SupplierDocumentKind;
  importMode: IngestionImportMode;
  coverage?: AssortmentCoverage;
  sourceId: string;
  sourceChecksum?: string;
  observedAt: Date;
  items: CanonicalSupplierRecord[];
}
