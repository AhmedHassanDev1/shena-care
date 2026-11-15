import { CanonicalResearchService } from '../../src/modules/catalog/research/canonical-research.service';
import { isVerifiedBrandShop } from '../../src/modules/catalog/research/product-source-discovery';
import { isTrustedMediaSource } from '../../src/platform/security/media-review';
import { CatalogSnapshotService } from '../../src/modules/catalog/services/catalog-snapshot.service';
import { BrandDetector } from '../../src/modules/intake/public';

describe('manufacturer source and reviewed brand contracts', () => {
  it('recognizes Capixy only on its verified owner shop and keeps lookalikes out', async () => {
    const fetcher = { fetch: jest.fn().mockImplementation(async (url, options) => options.isApprovedHost(new URL(url).hostname)
      ? { outcome: 'OK', finalUrl: url, body: Buffer.from('<h1>Capixy Shampoo 250ml</h1>') }
      : { outcome: 'HOST_NOT_APPROVED' }) };
    const service = new CanonicalResearchService({} as never, {} as never, {} as never, fetcher as never, {} as never, {} as never);
    const result = await service.checkSource({ brand: 'Capixy', productName: 'Shampoo', size: 250, sizeUnit: 'ml', barcode: null, websiteUrl: null }, 'https://e-majestic.com/products/capixy-shampoo-250ml');
    expect(result).toMatchObject({ tier: 'OFFICIAL_MANUFACTURER', outcome: 'OK', identityMatched: true, sizeConfirmed: true });
    expect(isTrustedMediaSource('https://e-majestic.com/products/capixy-shampoo-250ml')).toBe(true);
    expect(isVerifiedBrandShop('e-majestic.com', 'StarVille')).toBe(false);
    expect(isVerifiedBrandShop('e-majestic.com.evil.example', 'Capixy')).toBe(false);
    expect(isVerifiedBrandShop('fake-e-majestic.com', 'Capixy')).toBe(false);
  });

  it('detects the manufacturer-stated Eva name without creating another canonical brand', async () => {
    const db = { ingestionEligibilityPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      brand: { findMany: jest.fn().mockResolvedValue([{ id: 'eva', name: 'Eva Cosmetics', websiteUrl: 'https://eva-cosmetics.com', profile: null }]) },
      brandDraft: { findMany: jest.fn().mockResolvedValue([]) }, category: { findMany: jest.fn().mockResolvedValue([]) },
      sku: { findMany: jest.fn().mockResolvedValue([]) }, skuBarcodeAlias: { findMany: jest.fn().mockResolvedValue([]) } };
    const snapshot = await new CatalogSnapshotService(db as never).identitySnapshot();
    const detector = new BrandDetector(snapshot.brands);
    expect(detector.detect('Aloe Eva Hair Oil 255 ml')).toEqual([expect.objectContaining({ brandId: 'eva', basis: 'EXACT' })]);
    expect(detector.detect('إيفا ريسيبي بلسم ٣٥٠ مل')).toEqual([expect.objectContaining({ brandId: 'eva', basis: 'EXACT' })]);
  });

  it.each(['VERIFIED', 'UNVERIFIED'])('revalidates image evidence against only a %s profile alias', async status => {
    const page = 'https://manufacturer.example/products/recipe-conditioner';
    const image = 'https://manufacturer.example/cdn/shop/files/conditioner.png';
    const db = { productFactProposal: { findUnique: jest.fn().mockResolvedValue({ skuId: 'sku', field: 'media.sourceImages', status: 'PROPOSED', value: [image], evidence: [{ sourceUrl: page, sourceTier: 'OFFICIAL_MANUFACTURER' }] }) },
      ingestionEligibilityPolicy: { findFirst: jest.fn().mockResolvedValue(null) }, brandDraft: { findMany: jest.fn().mockResolvedValue([]) },
      sku: { findUnique: jest.fn().mockResolvedValue({ size: { toNumber: () => 350 }, sizeUnit: 'ml', barcode: null,
        product: { name: 'Recipe Conditioner Coconut Scent', brandId: 'brand', brand: { name: 'ExampleBrand', websiteUrl: 'https://manufacturer.example', profile: { aliases: [{ value: 'Official Legacy Label', status }] } } } }) } };
    const fetcher = { fetch: jest.fn().mockImplementation(async (_url, options) => ({ outcome: 'OK', finalUrl: page,
      body: Buffer.from(options.kind === 'page' ? `<h1>Official Legacy Label Recipe Conditioner Coconut Scent 350 ml</h1><meta property="og:image" content="${image}">` : 'native-image'), contentType: options.kind === 'page' ? 'text/html' : 'image/png' })) };
    const service = new CanonicalResearchService(db as never, {} as never, {} as never, fetcher as never, {} as never, {} as never);
    if (status === 'VERIFIED') await expect(service.fetchSourceImage('fact', image)).resolves.toMatchObject({ skuId: 'sku' });
    else {
      await expect(service.fetchSourceImage('fact', image)).rejects.toMatchObject({ response: { code: 'IMAGE_VARIANT_NOT_CONFIRMED' } });
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    }
  });
});
