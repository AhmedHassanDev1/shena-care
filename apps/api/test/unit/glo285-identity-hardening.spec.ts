// GLO-285: adversarial identity facts beyond the original 24/16 corpus. Synthetic entities only (no database).
import { ProductIdentityService } from '../../src/modules/ingestion/services/product-identity.service';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { CanonicalNormalizationUtils } from '../../src/modules/ingestion/adapters/source-adapter.interface';
import { foldIdentityText, parseIdentityTitle, phoneticSkeleton, titleFactConflict, wordingOverlap } from '../../src/modules/ingestion/services/identity-text';
import { compileEligibilityPolicy, EligibilityDocument } from '../../src/modules/ingestion/services/ingestion-eligibility.policy';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { BrandService, CatalogService } from '../../src/modules/catalog/public';

const canonical = (name: string, patch: Record<string, unknown> = {}) => ({
  id: 'SYN-A', productId: 'SYN-P', code: 'SYN-A', isActive: true,
  product: { name, brand: { name: 'CeraVe' } },
  size: { toNumber: () => 236 }, sizeUnit: 'ml', packCount: null, variantName: 'Default',
  barcode: '2000000000015', barcodeAliases: [], ...patch,
});
const normalizer = new RowNormalizationService();
const service = new ProductIdentityService({} as PrismaService, {} as CatalogService, {} as BrandService, normalizer);
const row = { eligibilityApproved: true, supplierId: 'supplier', supplierSkuCode: 'code', brand: 'CeraVe', size: 236, sizeUnit: 'ml' };

describe('GLO-285 hard vetoes never pass through a reused code or a shared barcode', () => {
  // [supplier wording, canonical wording]. Every pair names two different products in the same pack.
  const contradictions: Array<[string, string]> = [
    ['سيرافي سيروم فيتامين سي 236 مل', 'CeraVe Retinol Serum'],
    ['سيرافي غسول للبشرة الدهنية 236 مل', 'CeraVe Hydrating Cleanser For Dry Skin'],
    ['سيرافي لوشن للجسم 236 مل', 'CeraVe Face Lotion'],
    ['CeraVe Foam Cleanser', 'CeraVe Gel Cleanser'],
    ['سيرافي واقي شمس 236 مل', 'CeraVe Moisturizing Cream'],
    ['سيرافي تونر 236 مل', 'CeraVe Hydrating Cleanser'],
    ['سيرافي شامبو ضد القشرة 236 مل', 'CeraVe Anti Hair Fall Shampoo'],
    ['سيرافي كريم تفتيح 236 مل', 'CeraVe Anti Aging Cream'],
    ['CeraVe Retinol Niacinamide Serum', 'CeraVe Retinol Serum'],
    ['سيرافي مقشر 236 مل', 'CeraVe Moisturizing Lotion'],
  ];
  it.each(contradictions)('explicit conflict through alias: %s vs %s', (name, product) => {
    expect(service.validateIdentity({ ...row, name }, canonical(product), true).state).toBe('EXPLICIT_CONFLICT');
  });
  it.each(contradictions)('explicit conflict through barcode: %s vs %s', (name, product) => {
    expect(service.validateIdentity({ ...row, name, barcode: '2000000000015' }, canonical(product)).state).toBe('EXPLICIT_CONFLICT');
  });

  it.each([
    ['سيرافي غسول بلوبيري 236 مل', 'CeraVe Hydrating Cleanser'],
    ['سيرافي غسول اكسترا ماكس 236 مل', 'CeraVe Hydrating Cleanser'],
    ['سيرافي كريم 236 مل', 'CeraVe Moisturizing Cream'],
  ])('cross-script wording with unaccounted or generic tokens abstains: %s', (name, product) => {
    expect(service.validateIdentity({ ...row, name }, canonical(product), true).state).toBe('INSUFFICIENT_EVIDENCE');
  });

  it.each([
    ['سيرافي غسول مرطب 236 مل', 'CeraVe Hydrating Cleanser'],
    ['سيرافي هيدراتينج كلينزر 236 مل', 'CeraVe Hydrating Cleanser'],
    ['CeraVe Hydrating Cleanser 236 ml', 'CeraVe Hydrating Facial Cleanser'],
    ['غسول رغوي للبشرة الدهنية سيرافي 236 مل', 'CeraVe Foaming Cleanser For Oily Skin'],
    ['سيروم ريتينول سيرافي 236 مل', 'CeraVe Retinol Serum'],
  ])('legitimate reviewed translation survives: %s', (name, product) => {
    expect(service.validateIdentity({ ...row, name }, canonical(product), true).state).toBe('VERIFIED_IDENTITY');
  });
});

describe('GLO-285 missing facts are unknown', () => {
  it('a canonical SKU without a recorded size cannot corroborate a stated size, and does not contradict it', () => {
    const decision = service.validateIdentity({ ...row, name: 'CeraVe Test Cleanser' },
      canonical('CeraVe Test Cleanser', { size: null, sizeUnit: null }), true);
    expect(decision.state).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('a row without size cannot verify through a reused supplier code', () => {
    expect(service.validateIdentity({ ...row, size: null, sizeUnit: null, name: 'CeraVe Test Cleanser' },
      canonical('CeraVe Test Cleanser'), true).state).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('one single unit is the same pack fact as an unpacked canonical SKU', () => {
    expect(service.validateIdentity({ ...row, packageCount: 1, name: 'CeraVe Test Cleanser' },
      canonical('CeraVe Test Cleanser'), true).state).toBe('VERIFIED_IDENTITY');
  });
  it('the catalog SPF column vetoes a contradictory stated SPF', () => {
    const sku = canonical('CeraVe Sunscreen', { product: { name: 'CeraVe Sunscreen', spf: 30, brand: { name: 'CeraVe' } } });
    expect(service.validateIdentity({ ...row, name: 'CeraVe Sunscreen SPF50' }, sku, true).state).toBe('EXPLICIT_CONFLICT');
    expect(service.validateIdentity({ ...row, name: 'CeraVe Sunscreen SPF30' }, sku, true).state).toBe('VERIFIED_IDENTITY');
  });
  it('an Arabic SPF statement is a formula marker', () => {
    const sku = canonical('CeraVe Sunscreen SPF 30');
    expect(service.validateIdentity({ ...row, name: 'سيرافي واقي شمس عامل حماية ٥٠ 236 مل' }, sku, true).state).toBe('EXPLICIT_CONFLICT');
  });
  it('measures in a different unit compare as physical quantities, not strings', () => {
    const litre = canonical('CeraVe Test Cleanser', { size: { toNumber: () => 1 }, sizeUnit: 'L' });
    expect(service.validateIdentity({ ...row, size: 1000, sizeUnit: 'ml', name: 'CeraVe Test Cleanser' }, litre, true).state).toBe('VERIFIED_IDENTITY');
    expect(service.validateIdentity({ ...row, size: 500, sizeUnit: 'ml', name: 'CeraVe Test Cleanser' }, litre, true).state).toBe('EXPLICIT_CONFLICT');
  });
});

describe('GLO-285 GTIN evidence at every intake adapter', () => {
  it('source adapters retain contaminated codes as absent evidence instead of stripping them into a GTIN', () => {
    expect(CanonicalNormalizationUtils.normalizeBarcode('abc2000000000015')).toBeNull();
    expect(CanonicalNormalizationUtils.normalizeBarcode('٢٠٠٠٠٠٠٠٠٠٠١٥')).toBe('2000000000015');
    expect(CanonicalNormalizationUtils.normalizeBarcode(' 2000000000015 ')).toBe('2000000000015');
  });
  it('a leading-zero GTIN form is one identity, while a case-pack indicator digit is not', () => {
    expect(service.validateIdentity({ ...row, name: 'CeraVe Test Cleanser', barcode: '0036000291452' },
      canonical('CeraVe Test Cleanser', { barcode: '036000291452' })).state).toBe('VERIFIED_IDENTITY');
    expect(service.validateIdentity({ ...row, name: 'CeraVe Test Cleanser', barcode: '10036000291459' },
      canonical('CeraVe Test Cleanser', { barcode: '036000291452' })).state).toBe('EXPLICIT_CONFLICT');
  });
});

describe('GLO-285 Egyptian Arabic text', () => {
  it.each([
    ['سيرافي\u200c غسول', 'سيرافي غسول'], ['كریم', 'كريم'], ['ﻛﺮﻳﻢ', 'كريم'], ['۲۳۶', '236'], ['٢٣٦', '236'], ['سَيرافِى', 'سيرافي'], ['مـــرطب', 'مرطب'], ['١٫٥', '1.5'],
  ])('folds %s', (raw, folded) => expect(foldIdentityText(raw)).toBe(folded));

  it.each([
    ['2 x 100ml', 100, 'ml', 2], ['100ml x 2', 100, 'ml', 2], ['2*100 مل', 100, 'ml', 2], ['١٠٠ مل × ٢', 100, 'ml', 2], ['٣٠مل', 30, 'ml', null], ['30 سي سي', 30, 'ml', null],
    ['30 cc', 30, 'ml', null], ['50 م.ل', 50, 'ml', null], ['١٫٥ لتر', 1500, 'ml', null], ['50 جرام', 50, 'g', null], ['50 غم', 50, 'g', null], ['3 عبوات 50 جم', 50, 'g', 3], ['100 ml', 100, 'ml', null],
  ])('reads the packaging in %s', (title, size, unit, pack) => {
    expect(normalizer.extractSizeAndPack(`Cream ${title}`)).toMatchObject({ size, unit, packCount: pack });
  });
  it('a multiplication sign never fuses two quantities into one size', () => {
    expect(normalizer.extractSizeAndPack('Cream 2*100ml').size).toBe(100);
  });

  it.each([['سيرافي', 'CeraVe'], ['بيوديرما', 'Bioderma'], ['فيشي', 'Vichy'], ['سيتافيل', 'Cetaphil'], ['نيتروجينا', 'Neutrogena'], ['بانوكسيل', 'PanOxyl'], ['لاروش بوزيه', 'La Roche Posay'], ['ديرماكتيف', 'Dermactive']])(
    'transliteration skeleton links %s and %s', (arabic, latin) => expect(phoneticSkeleton(arabic)).toBe(phoneticSkeleton(latin)));

  it('typos may rank a candidate, but a misspelled fact cannot contradict or corroborate anything', () => {
    const typo = parseIdentityTitle('سيروم هيالورويك');
    const canonical = parseIdentityTitle('Hyaluronic Serum');
    expect(wordingOverlap(typo, canonical)).toBeGreaterThan(wordingOverlap(parseIdentityTitle('سيروم مختلف'), canonical));
    expect(typo.facts.active.size).toBe(0);
    expect(titleFactConflict(parseIdentityTitle('سيروم ريتينال'), parseIdentityTitle('Retinol Serum'))).toBe(true);
  });
});

describe('GLO-285 fuzzy brand retrieval never admits', () => {
  const document: EligibilityDocument = { resolutionVersion: 2,
    brands: [{ id: 'b', name: 'CeraVe', aliases: ['سيرافي'], isActive: true, effect: 'ALLOW' }, { id: 'l', name: 'La Roche-Posay', aliases: [], isActive: true, effect: 'ALLOW' }],
    categories: [{ id: 'c', name: 'Cleansers', parentId: null, isActive: true, effect: 'ALLOW' }], mappings: [] };
  const policy = compileEligibilityPolicy({ id: 'p', version: 1, document });
  it.each([['سيرافيي', 'b'], ['سرافي', 'b'], ['Cera Vee', 'b'], ['LRP', 'l'], ['لاروش بوزيه', 'l']])(
    '%s is suggested for review and stays on HOLD', (label, brandId) => {
      expect(policy.suggestBrands(label).map(s => s.brandId)).toContain(brandId);
      expect(policy.evaluate('s', label, 'Cleansers')).toMatchObject({ outcome: 'HOLD' });
    });
  it('a reviewed alias inside a title with form words still admits, and an alternative claim does not', () => {
    expect(policy.evaluate('s', 'سيرافي تونر للوجه', 'Cleansers')).toMatchObject({ outcome: 'ALLOW', brandId: 'b' });
    expect(policy.evaluate('s', 'بديل سيرافي', 'Cleansers')).toMatchObject({ outcome: 'HOLD' });
  });
});
