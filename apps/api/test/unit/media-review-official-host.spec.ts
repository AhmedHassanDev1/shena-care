import { isTrustedMediaSource, requireMediaReview } from '../../src/platform/security/media-review';

describe('L’Oréal Paris Middle East media source', () => {
  const review = {
    sourceUrl: 'https://www.loreal-paris-me.com/en/elvive/hyaluron-moisture/hyaluron-moisture-shampoo-200ml',
    sourceType: 'OFFICIAL_MANUFACTURER',
    reviewedBy: '7616f6a0-1c73-4356-8a0a-03b505bd7a06',
    reviewedAt: '2026-11-10T16:06:40.902Z',
    skuId: '42d46d14-ee2b-46ca-a034-94a1578dfd68',
    barcode: null,
    identityVerification: 'EVIDENCE_VERIFIED',
    size: 200,
    sizeUnit: 'ml',
    variantName: '200 ml',
    isTest: false,
  } as const;

  it('accepts a reviewed exact SKU image from the official regional manufacturer', () => {
    expect(isTrustedMediaSource(review.sourceUrl)).toBe(true);
    expect(requireMediaReview(review)).toMatchObject(review);
  });

  it.each([
    'https://loreal-paris-me.com.evil.example/image',
    'http://www.loreal-paris-me.com/image',
    'https://user@www.loreal-paris-me.com/image',
  ])('rejects a lookalike or insecure source %s', sourceUrl => {
    expect(isTrustedMediaSource(sourceUrl)).toBe(false);
    expect(() => requireMediaReview({ ...review, sourceUrl })).toThrow();
  });
});
