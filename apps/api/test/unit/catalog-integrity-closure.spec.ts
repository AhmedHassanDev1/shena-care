import { extractProductFacts } from '../../src/modules/catalog/research/product-fact-extractor';
import { requireMediaReview } from '../../src/platform/security/media-review';
import { CatalogPublicationService } from '../../src/application/composition/services/catalog-publication.service';

describe('confirmed catalog integrity defects', () => {
  const sku = { brand: 'Acme', productName: 'Niacinamide Serum', size: 30, sizeUnit: 'ml', barcode: null };
  const page = (body: string) => `<h1>Acme Niacinamide Serum 30ml</h1>${body}`;
  it.each(['1234567890123', '0000000000000', 'EAN3337875597180', '3337875597181'])('does not trust invalid structured GTIN %s', gtin => {
    const result = extractProductFacts(page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Acme Niacinamide Serum 30ml', gtin13: gtin })}</script>`), 'https://acme.example/serum', sku);
    expect(result.facts.find(f => f.field === 'identity.gtin')).toBeUndefined();
  });
  it('does not accept a valid GTIN-8 mislabelled as GTIN-13', () => {
    const result = extractProductFacts(page('<script type="application/ld+json">{"@type":"Product","name":"Acme Niacinamide Serum 30ml","gtin13":"96385074"}</script>'), 'https://acme.example/serum', sku);
    expect(result.facts.find(f => f.field === 'identity.gtin')).toBeUndefined();
  });
  it('retains checksum-valid structured GTIN and genuine ingredient features', () => {
    const result = extractProductFacts(page('<script type="application/ld+json">{"@type":"Product","name":"Acme Niacinamide Serum 30ml","gtin13":"3337875597180"}</script><h3>Niacinamide</h3><p>Helps calm skin.</p>'), 'https://acme.example/serum', sku);
    expect(result.facts.find(f => f.field === 'identity.gtin')?.value).toBe('3337875597180');
    expect(result.facts.find(f => f.field === 'composition.keyIngredients')?.value).toEqual([{ name: 'Niacinamide', function: 'Helps calm skin.' }]);
  });
  it.each(['Learn More About Niacinamide', 'Read more about Hyaluronic Acid', 'Shop Niacinamide'])('does not turn navigation into an ingredient: %s', heading => {
    const result = extractProductFacts(page(`<h3>${heading}</h3><p>Read More Here</p>`), 'https://acme.example/serum', sku);
    expect(result.facts.find(f => f.field === 'composition.keyIngredients')).toBeUndefined();
  });

  const review = { sourceUrl: 'https://www.cerave.com/product', sourceType: 'OFFICIAL_MANUFACTURER', reviewedBy: '7616f6a0-1c73-4356-8a0a-03b505bd7a06', reviewedAt: '2026-11-13T12:00:00Z', size: 30, sizeUnit: 'ml', variantName: '30ml', isTest: false };
  it.each(['1234567890123', '3337875597180'])('a barcode alone never authorizes identity media: %s', barcode => {
    expect(() => requireMediaReview({ ...review, barcode, identityVerification: 'UNVERIFIED' })).toThrow();
  });
  it('keeps evidence-verified no-barcode identity and refuses an invalid asserted barcode', () => {
    expect(requireMediaReview({ ...review, barcode: null, identityVerification: 'EVIDENCE_VERIFIED' })).toMatchObject({ barcode: null });
    expect(() => requireMediaReview({ ...review, barcode: '1234567890123', identityVerification: 'EVIDENCE_VERIFIED' })).toThrow();
  });
  it('publication requires verified identity even with a checksum-valid barcode present', async () => {
    const catalog = { getSkuDetail: jest.fn().mockResolvedValue({ identityStatus: 'UNVERIFIED', barcode: '3337875597180', size: 30, sizeUnit: 'ml', variantName: '30 ml', product: {} }) };
    const service = new CatalogPublicationService(catalog as never, { readiness: jest.fn().mockResolvedValue({ roles: {} }) } as never,
      { getListing: jest.fn(), getCurrentSellingPrice: jest.fn() } as never,
      { factSummary: jest.fn().mockResolvedValue({ applied: [], pending: [], conflicts: [] }) } as never,
      { openForSku: jest.fn().mockResolvedValue([]) } as never);
    expect((await service.readiness('sku')).blockers).toContain('IDENTITY_NOT_VERIFIED');
  });
});
