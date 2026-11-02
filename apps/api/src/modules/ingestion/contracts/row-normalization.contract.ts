import { QuantityPresence, CanonicalPriceType } from './canonical-supplier-record.contract';

export enum NormalizedRowStatus {
  UPDATED_CANDIDATE = 'UPDATED_CANDIDATE',
  UNCHANGED = 'UNCHANGED',
  REVIEW = 'REVIEW',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
  INVALID = 'INVALID',
}

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
}

export interface TypedDiscount {
  type: DiscountType;
  value: number;
  rawInput?: string;
}

export interface ProductScopeClassification {
  isEligible: boolean;
  category: 'skincare' | 'haircare' | 'unknown' | 'excluded' | 'approved';
  confidence: number;
  matchedRules: string[];
  reason?: string;
}

export interface NormalizedRowPricing {
  purchaseCost: number | null;
  retailReferencePrice: number | null;
  currency: string;
  discount?: TypedDiscount | null;
  isVerifiedCost: boolean;
}

export interface NormalizedRowInventory {
  presence: QuantityPresence;
  reportedQuantity: number | null;
  isInStock: boolean | null;
  isInvoiceLineQuantity?: boolean;
}

export interface NormalizedProductRow {
  sourceRowNumber: number;
  status: NormalizedRowStatus;
  statusReason?: string;

  // Normalized identifiers
  normalizedSku: string;
  normalizedBrand: string;
  normalizedTitle: string;
  cleanBaseTitle: string;
  normalizedBarcode: string | null;

  // Extracted attributes
  extractedSize?: number | null;
  extractedUnit?: string | null;
  extractedPackCount?: number | null;

  // Verified financial & inventory semantics
  pricing: NormalizedRowPricing;
  inventory: NormalizedRowInventory;

  scope: ProductScopeClassification;
  /**
   * Why a REVIEW row is held: `scope` (category not recognised — an exact catalog match can still prove it) and/or
   * `fields` (quantity/price/discount doubts — never fast-laned). Absent on rows that are not REVIEW.
   */
  holds?: { scope: boolean; fields: boolean };
  rawEvidence: Record<string, any>;
  observedAt: Date;
  /** Supplier-reported effective/export time of this row (ISO), when the file states one. Advisory, never receipt time. */
  sourceObservedAt?: string | null;
}
