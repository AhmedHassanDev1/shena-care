import { CatalogPublicationService } from '../../src/application/composition/services/catalog-publication.service';

describe('packaging evidence is separate from mandatory physical identity', () => {
  const readiness = async (carton: boolean | null, exceptions: unknown[] = [], proof = 'MISSING') => {
    const service = new CatalogPublicationService({ getSkuDetail: jest.fn().mockResolvedValue({ id: 'sku', productId: 'product', identityStatus: 'EVIDENCE_VERIFIED', barcode: null,
      size: 30, sizeUnit: 'ml', variantName: '30 ml', hasOuterCarton: carton, product: { categoryId: 'serums', isPublished: false } }) } as never,
    { readiness: jest.fn().mockResolvedValue({ roles: { PRIMARY_PACKSHOT: 'APPROVED', PACKAGING_PROOF: proof, CATEGORY_EDITORIAL: 'MISSING' } }) } as never,
    { getListing: jest.fn().mockResolvedValue({ isListed: true }), getCurrentSellingPrice: jest.fn().mockResolvedValue({ amount: 950, currency: 'EGP' }) } as never,
    { factSummary: jest.fn().mockResolvedValue({ applied: ['composition.inci', 'usage.instructions'], conflicts: [], pending: [] }) } as never,
    { openForSku: jest.fn().mockResolvedValue(exceptions) } as never);
    return service.readiness('sku');
  };
  it('keeps unknown carton explicitly unverified without inventing absence or blocking a valid bottle', async () => {
    const result = await readiness(null);
    expect(result.ready).toBe(true);
    expect(result.warnings).toContain('CARTON_UNVERIFIED');
    expect(result.packaging.outerCarton).toBe('UNVERIFIED');
  });
  it('keeps an explicit boxed-pack claim on hold until its packaging proof is approved', async () => {
    expect((await readiness(true)).blockers).toContain('CARTON_PROOF_NOT_APPROVED');
    expect((await readiness(true, [], 'APPROVED')).ready).toBe(true);
  });
  it('never clears a packaging identity, barcode, safety or deliverable hold just because carton is unknown', async () => {
    expect((await readiness(null, [{ reasonCode: 'PACKAGING_IDENTITY_HOLD', severity: 'CRITICAL' }])).blockers).toContain('CRITICAL_EXCEPTION_OPEN');
  });
});
