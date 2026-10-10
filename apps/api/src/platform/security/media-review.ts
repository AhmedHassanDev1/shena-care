import { BadRequestException } from '@nestjs/common';

export interface MediaReview {
  sourceUrl: string;
  sourceType: 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR';
  reviewedBy: string;
  reviewedAt: string;
  skuId?: string;
  candidateId?: string;
  barcode: string;
  size: number;
  sizeUnit: string;
  variantName: string;
  isTest: boolean;
}

export function isTrustedMediaSource(value: string): boolean {
  try {
    const url = new URL(value);
    const hosts = [
      'cerave.com', 'laroche-posay.us', 'laroche-posay.co.uk', 'laroche-posay-me.com',
      'vichy.fr', 'vichyusa.com', 'eucerin.com', 'eucerinus.com',
      'aveneusa.com', 'eau-thermale-avene.com', 'bioderma.com',
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
      !Number.isFinite(Date.parse(m.reviewedAt)) || !m.barcode ||
      !Number.isFinite(m.size) || m.size <= 0 || !m.sizeUnit || !m.variantName ||
      !['OFFICIAL_MANUFACTURER', 'TRUSTED_DISTRIBUTOR'].includes(m.sourceType) ||
      !isTrustedMediaSource(m.sourceUrl)) {
    throw new BadRequestException('Verified media requires trusted evidence and an identity review');
  }
  return m;
}
