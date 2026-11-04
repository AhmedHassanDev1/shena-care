import { ProductIdentityService } from '../../src/modules/ingestion/services/product-identity.service';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { BrandService, CatalogService } from '../../src/modules/catalog/public';

const sku = { id: 'SYN-A', productId: 'SYN-P', code: 'SYN-A', isActive: true,
  product: { name: 'CeraVe Test Cleanser', brand: { name: 'CeraVe' } },
  size: { toNumber: () => 236 }, sizeUnit: 'ml', packCount: null, variantName: 'Default',
  barcode: '2000000000015', barcodeAliases: [] };
const normalizer = new RowNormalizationService();
function fixture(alias: boolean) {
  const db = { supplierSkuAlias: { findUnique: async () => alias ? { sku, skuId: sku.id } : null,
    findMany: async () => alias ? [{ sku, skuId: sku.id, supplierSkuCode: 'code' }] : [] },
    sku: { findMany: async () => [sku], findFirst: async () => null },
    skuBarcodeAlias: { findMany: async () => [], findFirst: async () => null } };
  return new ProductIdentityService(db as unknown as PrismaService, {} as CatalogService, {} as BrandService, normalizer);
}
const formats = [(s: string) => s, (s: string) => `  ${s}  `, (s: string) => s.replace(/ /g, '  '),
  (s: string) => `${s}.`, (s: string) => `(${s})`, (s: string) => `${s} !`, (s: string) => `${s} /`, (s: string) => `${s} -`];
const input = { eligibilityApproved: true, supplierId: 'supplier', supplierSkuCode: 'code',
  name: sku.product.name, brand: 'CeraVe', size: 236, sizeUnit: 'ml' };

describe('GLO-285 P0 identity safety', () => {
  for (const [index, format] of formats.entries()) {
    it.each([
      [true, 'CeraVe Test Retinol Serum', false],
      [true, 'سيرافي بتاع الحبوب', true],
      [false, 'CeraVe Test Retinol Serum', false],
    ])(`blocks unsafe baseline family, formatting ${index}: %s %s`, async (alias, name, vague) => {
      const result = await fixture(alias).classifyCandidateMatch({ ...input, name: format(name),
        ...(vague ? { size: null, sizeUnit: null } : {}), ...(alias ? {} : { barcode: sku.barcode }) });
      expect(result.matchedSkuId).toBeNull();
      expect(result.classification).not.toBe('EXACT_MATCH');
    });
    it.each([true, false])(`preserves exact control, formatting ${index}: alias=%s`, async alias => {
      const result = await fixture(alias).classifyCandidateMatch({ ...input, name: format(input.name),
        ...(alias ? {} : { barcode: sku.barcode }) });
      expect(result).toMatchObject({ classification: 'EXACT_MATCH', matchedSkuId: sku.id });
    });
  }
  it.each([
    ['1234567890123', false, '1234567890123'], ['abc2000000000015', false, null],
    ['٢٠٠٠٠٠٠٠٠٠٠١٥', true, '2000000000015'], ['2000000000015', true, '2000000000015'],
    ['96385074', true, '96385074'], ['036000291452', true, '036000291452'],
    ['10012345000017', true, '10012345000017'],
  ])('validates GTIN evidence %s', (raw, isValid, barcode) => {
    expect(normalizer.normalizeBarcode(raw)).toEqual({ barcode, isValid });
  });
  it('preserves an informative translated supplier alias with corroborating packaging', async () => {
    expect(await fixture(true).classifyCandidateMatch({ ...input, name: 'غسول سيرافي تيست ٢٣٦ مل' }))
      .toMatchObject({ classification: 'EXACT_MATCH', matchedSkuId: sku.id });
  });
  it('reviewed aliases permit equivalent English forms without literal title equality', async () => {
    expect(await fixture(true).classifyCandidateMatch({ ...input, name: 'CeraVe Test Face Wash 236ml' }))
      .toMatchObject({ classification: 'EXACT_MATCH', matchedSkuId: sku.id });
  });
  it.each([{ size: 473 }, { sizeUnit: 'g' }, { variantName: 'Tinted' }, { packageCount: 2 },
    { brand: 'Bioderma' }, { barcode: '2000000000022' }])('retains physical veto %j', async patch => {
    expect(await fixture(true).classifyCandidateMatch({ ...input, ...patch })).toMatchObject({ classification: 'CONFLICT', matchedSkuId: null });
  });
  it('a valid checksum never overrides formulation disagreement', async () => {
    expect(await fixture(false).classifyCandidateMatch({ ...input, name: 'CeraVe Retinol Serum 1%', barcode: sku.barcode }))
      .toMatchObject({ classification: 'CONFLICT', matchedSkuId: null });
  });
  it.each(['CeraVe Test Cleanser SPF30', 'CeraVe Test Cleanser version 1'])('vetoes changed version facts: %s', name => {
    const canonical = { ...sku, product: { ...sku.product, name: name.replace('30', '50').replace('version 1', 'version 2') } };
    expect(fixture(true).validateIdentity({ ...input, name, barcode: sku.barcode }, canonical, true).state).toBe('EXPLICIT_CONFLICT');
  });
  it('retained structured size cannot hide a contradictory size in the title', () => {
    expect(fixture(true).validateIdentity({ ...input, name: 'CeraVe Test Cleanser 473ml' }, sku, true).state).toBe('EXPLICIT_CONFLICT');
  });
  it('generic translated form and brand alone do not establish an alias identity', () => {
    expect(fixture(true).validateIdentity({ ...input, name: 'غسول سيرافي' }, sku, true).state).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('new and old formula labels are contradictory even with a shared barcode', () => {
    const canonical = { ...sku, product: { ...sku.product, name: 'CeraVe Cleanser old formula' } };
    expect(fixture(true).validateIdentity({ ...input, name: 'CeraVe Cleanser new formula', barcode: sku.barcode }, canonical).state)
      .toBe('EXPLICIT_CONFLICT');
  });
  it.each(['غسول سيرافي بتاع الحبوب 236 مل', 'غسول سيرافي تيست إصدار 2 236 مل'])
  ('informal or unverified-version translations retain uncertainty: %s', name => {
    expect(fixture(true).validateIdentity({ ...input, name, barcode: sku.barcode }, sku, true).state)
      .toBe('INSUFFICIENT_EVIDENCE');
  });
  it('a substring of a product form is not independent translation evidence', () => {
    const canonical = { ...sku, product: { ...sku.product, name: 'غسول تيست' } };
    expect(fixture(true).validateIdentity({ ...input, name: 'notcleanser Test 236ml', barcode: sku.barcode }, canonical, true).state)
      .toBe('INSUFFICIENT_EVIDENCE');
  });
});
