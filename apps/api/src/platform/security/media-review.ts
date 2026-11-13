import { BadRequestException } from '@nestjs/common';
import { isValidGtin } from './gtin';

export interface MediaReview {
  sourceUrl: string;
  sourceType: 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR';
  reviewedBy: string;
  reviewedAt: string;
  skuId?: string;
  candidateId?: string;
  /** Present when known; identity may instead be verified by evidence (manufacturer page) or by an Admin. */
  barcode?: string | null;
  /** How the SKU's identity is verified, when it is: EVIDENCE_VERIFIED | BARCODE_VERIFIED | ADMIN_VERIFIED. */
  identityVerification?: string | null;
  size: number;
  sizeUnit: string;
  variantName: string;
  packCount?: number;
  isTest: boolean;
}

export function isTrustedMediaSource(value: string): boolean {
  try {
    const url = new URL(value);
    const hosts = [
      'cerave.com', 'laroche-posay.us', 'laroche-posay.co.uk', 'laroche-posay-me.com',
      'vichy.fr', 'vichyusa.com', 'eucerin.com', 'eucerinus.com',
      'aveneusa.com', 'eau-thermale-avene.com', 'bioderma.com',
      'loreal-paris-me.com',
      ...(process.env.MEDIA_TRUSTED_SOURCE_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
    ];
    return url.protocol === 'https:' && !url.username && !url.password &&
      hosts.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

export function requireMediaReview(value: unknown): MediaReview {
  const m = value as MediaReview | undefined;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!m || m.isTest !== false || !m.reviewedBy || !uuid.test(m.reviewedBy) || (m.skuId !== undefined && !uuid.test(m.skuId)) || !m.reviewedAt ||
      !Number.isFinite(Date.parse(m.reviewedAt)) || !['EVIDENCE_VERIFIED', 'BARCODE_VERIFIED', 'ADMIN_VERIFIED'].includes(m.identityVerification ?? '') ||
      (m.barcode != null && !isValidGtin(m.barcode)) ||
      !Number.isFinite(m.size) || m.size <= 0 || !m.sizeUnit || !m.variantName ||
      (m.packCount !== undefined && (!Number.isInteger(m.packCount) || m.packCount <= 0)) ||
      !['OFFICIAL_MANUFACTURER', 'TRUSTED_DISTRIBUTOR'].includes(m.sourceType) ||
      !isTrustedMediaSource(m.sourceUrl)) {
    throw new BadRequestException('Verified media requires trusted evidence and an identity review');
  }
  return m;
}

export type PublicMediaHiddenReason =
  | 'PRODUCT_NOT_PUBLISHED'
  | 'NOT_REVIEWED_MEDIA'
  | 'REVIEW_IDENTITY_MISMATCH'
  | 'NOT_STORED_LOCALLY';

/**
 * Whether the storefront may serve a product image from /storage/public/media. This is the single rule used both by
 * the public storage route (which enforces it) and by the Admin catalog (which only explains it). It never loosens
 * the gate: an image is public only for a published product whose review still matches the SKU identity.
 */
export function publicMediaVisibility(record: {
  originType: string;
  generationMetadata: unknown;
  product: {
    isPublished: boolean;
    skus: Array<{ id: string; isActive: boolean; barcode: string | null; size: { toNumber(): number } | number | null; sizeUnit: string | null; variantName: string }>;
  };
}): { live: boolean; reason: PublicMediaHiddenReason | null } {
  if (!record.product.isPublished) return { live: false, reason: 'PRODUCT_NOT_PUBLISHED' };
  if (record.originType !== 'verified' && record.originType !== 'derived') return { live: false, reason: 'NOT_REVIEWED_MEDIA' };
  let review: MediaReview;
  try {
    review = requireMediaReview(record.generationMetadata);
  } catch {
    return { live: false, reason: 'NOT_REVIEWED_MEDIA' };
  }
  const matches = record.product.skus.some((sku) => {
    const size = sku.size === null ? null : typeof sku.size === 'number' ? sku.size : sku.size.toNumber();
    return sku.id === review.skuId && sku.isActive && sku.barcode === review.barcode &&
      size === review.size && sku.sizeUnit === review.sizeUnit && sku.variantName === review.variantName;
  });
  return matches ? { live: true, reason: null } : { live: false, reason: 'REVIEW_IDENTITY_MISMATCH' };
}
