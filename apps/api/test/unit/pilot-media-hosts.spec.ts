import { isTrustedMediaSource, requireMediaReview } from '../../src/platform/security/media-review';

describe('verified manufacturer domains encountered in the real pilot', () => {
  const prior = process.env.MEDIA_TRUSTED_SOURCE_HOSTS;
  beforeAll(() => { process.env.MEDIA_TRUSTED_SOURCE_HOSTS = ''; });
  afterAll(() => { if (prior === undefined) delete process.env.MEDIA_TRUSTED_SOURCE_HOSTS; else process.env.MEDIA_TRUSTED_SOURCE_HOSTS = prior; });
  const review = { sourceType: 'OFFICIAL_MANUFACTURER', reviewedBy: '7616f6a0-1c73-4356-8a0a-03b505bd7a06', reviewedAt: '2026-11-13T19:11:00Z', skuId: 'e2ac479e-2ce3-47d3-89ab-d79de225879f', barcode: null, identityVerification: 'EVIDENCE_VERIFIED', size: 30, sizeUnit: 'ml', variantName: '30 ml', isTest: false };
  it.each(['https://theordinary.com/en-us/niacinamide-10-zinc-1-serum-100436.html', 'https://www.bioderma.co.uk/p/sensibio-h2o-micellar-water'])('accepts the actual official source without an environment-only workaround: %s', sourceUrl => {
    expect(isTrustedMediaSource(sourceUrl)).toBe(true);
    expect(() => requireMediaReview({ ...review, sourceUrl })).not.toThrow();
    expect(() => requireMediaReview({ ...review, sourceUrl, identityVerification: 'UNKNOWN' })).toThrow();
  });
  it.each(['https://theordinary.com.evil.example/p', 'https://bioderma.co.uk.evil.example/p', 'http://theordinary.com/p', 'https://user@theordinary.com/p'])('refuses lookalike and insecure domains: %s', sourceUrl => {
    expect(isTrustedMediaSource(sourceUrl)).toBe(false);
  });
});
