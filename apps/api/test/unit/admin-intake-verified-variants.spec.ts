import { AdminIntakeService } from '../../src/application/composition/services/intake/admin-intake.service';
import type { CatalogIdentitySnapshot } from '../../src/modules/catalog/public';
import { CandidateIndex, readMeasures } from '../../src/modules/intake/public';

describe('verified manufacturer variants stay distinct during Admin intake', () => {
  const brand = { id: 'brand', name: 'StarVille', aliases: [] };
  const oldPage = 'https://shop.parkvillepharma.com/products/hydrate';
  function fixture(productName = 'Femme Intimate Cleansing Foam Hydrate', packCount = 1) {
    const snapshot: CatalogIdentitySnapshot = { takenAt: new Date().toISOString(), policyVersion: 23, deniedLabels: [], categories: [],
      brands: [{ ...brand, websiteUrl: 'https://parkvillepharma.com', policyEffect: 'ALLOW', activeSkuCount: 1 }],
      skus: [{ skuId: 'existing', productId: 'existing-product', brandId: brand.id, productName, variantName: '150 ml', size: 150, sizeUnit: 'ml', packCount,
        barcodes: [], categoryId: null, productType: 'cleanser', identityStatus: 'EVIDENCE_VERIFIED', sourceUrls: [oldPage], isPublished: false }] };
    const catalog = { intake: jest.fn().mockResolvedValue({ skuId: 'new', createdProduct: true }), recordIdentityVerification: jest.fn() };
    const service = Object.create(AdminIntakeService.prototype) as AdminIntakeService;
    Object.assign(service, { catalog, snapshots: { leafCategoriesByName: jest.fn().mockResolvedValue(new Map([['cleansers', 'category']])) }, decisions: { record: jest.fn() } });
    const locate = service as unknown as { locateOrCreate: (...args: unknown[]) => Promise<{ skuId: string; created: boolean; basis: string }> };
    const run = (name: string, page: string, count: number | null = null, gtin: string | null = null) => locate.locateOrCreate(
      { rawName: `StarVille ${name} 150 ml`, barcode: null, job: { submittedBy: 'actor' } }, { packCount: count }, brand,
      { verifiedBy: { tier: 'OFFICIAL_MANUFACTURER', url: page, pageTitle: `StarVille ${name} 150 ml`, pageGtin: gtin }, size: { value: 150, unit: 'ml' }, productName: name }, snapshot);
    return { run, catalog, snapshot };
  }
  it('creates Refresh separately from Hydrate despite matching brand, size and most wording', async () => {
    const f = fixture();
    await expect(f.run('Femme Intimate Cleansing Foam Refresh', 'https://shop.parkvillepharma.com/products/refresh')).resolves.toMatchObject({ skuId: 'new', created: true });
    expect(f.catalog.intake).toHaveBeenCalledWith(expect.objectContaining({ name: 'Femme Intimate Cleansing Foam Refresh' }));
  });
  it('reuses the identical canonical name at another manufacturer URL', async () => {
    const f = fixture();
    await expect(f.run('Femme Intimate Cleansing Foam Hydrate', 'https://shop.parkvillepharma.com/collections/femme/products/hydrate')).resolves.toMatchObject({ skuId: 'existing', created: false });
    expect(f.catalog.intake).not.toHaveBeenCalled();
  });
  it('does not reuse the same page and per-unit size for a different pack count', async () => {
    const f = fixture();
    await expect(f.run('Femme Intimate Cleansing Foam Hydrate', oldPage, 4)).resolves.toMatchObject({ skuId: 'new', created: true });
    expect(f.catalog.intake).toHaveBeenCalledWith(expect.objectContaining({ packCount: 4 }));
  });
  it('gives distinct verified pack counts distinct canonical SKU codes', async () => {
    const f = fixture('Unrelated Facial Cleanser');
    await f.run('Femme Intimate Cleansing Foam Refresh', 'https://shop.parkvillepharma.com/products/refresh', 2);
    await f.run('Femme Intimate Cleansing Foam Refresh', 'https://shop.parkvillepharma.com/products/refresh', 4);
    const codes = f.catalog.intake.mock.calls.map(call => call[0].skuCode);
    expect(new Set(codes).size).toBe(2);
  });
  it.each([null, '6223012632708'])('never lets supplier wording override a named variant, including barcode %s', barcode => {
    const f = fixture();
    f.snapshot.skus[0].barcodes = ['6223012632708'];
    const index = new CandidateIndex(f.snapshot, new Map(), new Map());
    const result = index.match({ name: 'StarVille Femme Intimate Cleansing Foam Refresh 150 ml', barcode, code: null,
      measure: readMeasures('150 ml').measures[0], measureConflict: false, packCount: null, fingerprint: '' });
    expect(result.kind).not.toBe('MATCH');
    expect(result.candidates[0].vetoes).toContain('NAMED_VARIANT_DIFFERS');
  });
  it('holds a manufacturer barcode conflict even when page, native name and size match', async () => {
    const f = fixture();
    f.snapshot.skus[0].barcodes = ['3337875597180'];
    await expect(f.run('Femme Intimate Cleansing Foam Hydrate', oldPage, null, '6223012632708')).rejects.toMatchObject({ hold: { reasonCode: 'BARCODE_CONFLICT' } });
    expect(f.catalog.intake).not.toHaveBeenCalled();
  });
  it('does not soft-match an unknown supplier barcode over a different approved barcode', () => {
    const f = fixture();
    f.snapshot.skus[0].barcodes = ['3337875597180'];
    const result = new CandidateIndex(f.snapshot, new Map(), new Map()).match({ name: 'StarVille Femme Intimate Cleansing Foam Hydrate 150 ml',
      barcode: '6223012632708', code: null, measure: { size: 150, unit: 'ml' }, measureConflict: false, packCount: null, fingerprint: '' });
    expect(result.kind).not.toBe('MATCH');
    expect(result.candidates[0].vetoes).toContain('BARCODE_DIFFERS');
  });
});
