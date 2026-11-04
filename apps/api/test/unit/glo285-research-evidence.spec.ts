// GLO-285: pure evidence rules, adversarial provider output, source classification and row accounting. No database.
import { BadRequestException } from '@nestjs/common';
import { extractListedPrices } from '../../src/modules/ingestion/services/retail-price-observation.service';
import { evidenceExcerpt, hostIsBrandDomain, registrableLabel, statedSize, foldEvidenceText, validateExtractedFacts } from '../../src/modules/ingestion/services/research-evidence';
import { RowOutcomeSkipCollector, countOutcomeRows, isRowOutcomeGroup, rowAccounting } from '../../src/modules/ingestion/contracts/row-outcomes.contract';
import { validateSafeUrl } from '../../src/platform/security/url-validator';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';

const PAGE = `CeraVe Foaming Cleanser for normal to oily skin. Size: 236 ml.
Ingredients: Aqua, Glycerin, Niacinamide, Ceramide NP. Contains Niacinamide 4% for the skin barrier.
How to use: Apply to wet skin, massage gently and rinse. Texture: gel.`;

describe('validateExtractedFacts', () => {
  it('keeps only what the page states and reports the rest', () => {
    const { facts, rejected } = validateExtractedFacts({
      brand: 'CeraVe', size: { value: 236, unit: 'ml' }, texture: 'gel',
      ingredients: ['Niacinamide', 'Retinol', 'Glycerin'],
      concentrations: [{ ingredient: 'Niacinamide', percent: 4 }, { ingredient: 'Niacinamide', percent: 10 }, { ingredient: 'Retinol', percent: 1 }],
      usage: ['Apply to wet skin, massage gently and rinse.', 'Leave overnight for best anti-aging results.'],
      concerns: ['anti-aging'],
    }, PAGE);
    expect(facts.brand).toBe('CeraVe');
    expect(facts.size).toEqual({ value: 236, unit: 'ml' });
    expect(facts.ingredients).toEqual(['Niacinamide', 'Glycerin']);
    expect(facts.concentrations).toEqual([{ ingredient: 'Niacinamide', percent: 4 }]);
    expect(facts.usage).toEqual(['Apply to wet skin, massage gently and rinse.']);
    expect(facts.concerns).toEqual([]);
    expect(rejected.map(r => [r.field, r.reason])).toEqual(expect.arrayContaining([
      ['ingredients', 'not_stated_on_source_page'], ['concentrations', 'not_stated_on_source_page'], ['usage', 'not_stated_on_source_page'], ['concerns', 'not_stated_on_source_page'],
    ]));
  });

  it.each([
    ['a size the page does not state', { size: { value: 473, unit: 'ml' } }, 'size'],
    ['an invented brand', { brand: 'La Roche-Posay' }, 'brand'],
    ['a malformed size', { size: { value: '236', unit: 'ml' } }, 'size'],
    ['an unknown unit', { size: { value: 236, unit: 'bottles' } }, 'size'],
    ['a list that is not a list', { ingredients: 'Aqua, Glycerin' }, 'ingredients'],
    ['an impossible concentration', { concentrations: [{ ingredient: 'Niacinamide', percent: 400 }] }, 'concentrations'],
    ['an oversized list', { ingredients: Array(101).fill('Aqua') }, 'ingredients'],
  ])('drops %s', (_label, raw, field) => {
    const { facts, rejected } = validateExtractedFacts(raw, PAGE);
    expect(rejected.some(r => r.field === field)).toBe(true);
    expect((facts as Record<string, unknown>)[field] ?? []).toEqual([]);
  });

  it.each([null, 'text', 42, ['a']])('refuses non-object output %p', raw => {
    expect(validateExtractedFacts(raw, PAGE)).toEqual({ facts: {}, rejected: [expect.objectContaining({ reason: 'output_is_not_an_object' })] });
  });

  it('leaves absent facts unknown instead of defaulting them', () => {
    expect(validateExtractedFacts({ brand: 'CeraVe' }, PAGE).facts).toEqual({ brand: 'CeraVe' });
  });

  it('accepts a fact that ends a sentence, and keeps decimals whole', () => {
    expect(validateExtractedFacts({ ingredients: ['Ceramide NP', 'Glycerin'] }, 'Ingredients: Aqua, Glycerin, Ceramide NP.').facts.ingredients).toEqual(['Ceramide NP', 'Glycerin']);
    expect(statedSize(foldEvidenceText('Net content 1.5 l.'), { value: 1.5, unit: 'l' })).toBe(true);
    expect(statedSize(foldEvidenceText('Net content 1.5 l.'), { value: 5, unit: 'l' })).toBe(false);
  });

  it('does not treat 36 ml as stated by a page saying 236 ml', () => {
    expect(statedSize(foldEvidenceText(PAGE), { value: 36, unit: 'ml' })).toBe(false);
    expect(statedSize(foldEvidenceText(PAGE), { value: 236, unit: 'ml' })).toBe(true);
  });

  it('quotes the page in its excerpt', () => {
    expect(evidenceExcerpt(PAGE, 'Niacinamide')).toContain('Niacinamide');
  });
});

describe('official-source classification', () => {
  it.each([
    ['www.cerave.com', 'CeraVe', true],
    ['shop.cerave.com', 'CeraVe', true],
    ['cerave.com.eg', 'CeraVe', true],
    ['laroche-posay.co.uk', 'La Roche-Posay', true],
    ['cerave-deals.com', 'CeraVe', false],
    ['cerave.fake-shop.com', 'CeraVe', false],
    ['bestceravestore.net', 'CeraVe', false],
    ['pharmacy.com', 'سيرافي', false],
    ['anything.example.com', 'سيرافي', false],
    ['x.eg', 'X', false],
  ])('%s for brand %s is official: %s', (host, brand, expected) => {
    expect(hostIsBrandDomain(host, brand)).toBe(expected);
  });

  it('finds the registered name', () => {
    expect(registrableLabel('a.b.example.co.uk')).toBe('example');
    expect(registrableLabel('a.b.example.com')).toBe('example');
  });
});

describe('validateSafeUrl', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://[fd00::1]/',
    'http://100.64.0.1/', 'http://localhost./', 'http://intranet/', 'http://metadata.google.internal/', 'https://user:pass@example.com/', 'ftp://example.com/', 'http://[fe80::1]/',
  ])('refuses %s', url => {
    expect(() => validateSafeUrl(url)).toThrow(BadRequestException);
  });

  it.each(['https://www.shop.eva-cosmetics.com/products/x', 'https://8.8.8.8/', 'https://[2001:4860:4860::8888]/'])('allows %s', url => {
    expect(() => validateSafeUrl(url)).not.toThrow();
  });
});

describe('extractListedPrices', () => {
  it.each([
    ['Eva cream 50 g price 80 EGP', { price: 80, regular: null }],
    ['السعر ١٢٠ جنيه بدلاً من ١٥٠ جنيه', { price: 120, regular: 150 }],
    ['LE 1,250.50', { price: 1250.5, regular: null }],
  ])('reads %s', (text, expected) => {
    expect(extractListedPrices(text)).toEqual(expected);
  });

  it.each(['no prices here', '10 EGP 20 EGP 30 EGP'])('reads nothing from %s rather than guessing', text => {
    expect(extractListedPrices(text)).toBeNull();
  });
});

describe('row accounting', () => {
  const policy = { policyId: 'p', policyVersion: 3 };

  it('collapses exclusions into one entry per reason with compressed row ranges', () => {
    const skips = new RowOutcomeSkipCollector();
    for (let row = 2; row <= 40001; row++) skips.add('BRAND_NOT_ALLOWED', row, row % 2 ? 'A' : 'B');
    skips.add('CATEGORY_DENIED', 50000, 'A');
    const entries = skips.toEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ outcome: 'POLICY_SKIP', reason: 'BRAND_NOT_ALLOWED', count: 40000, rowRanges: [[2, 40001]] });
    expect(JSON.stringify(entries).length).toBeLessThan(400);
    expect(isRowOutcomeGroup(entries[0])).toBe(true);
    expect(countOutcomeRows(entries, 'POLICY_SKIP')).toBe(40001);
  });

  it('bounds tracked brand labels', () => {
    const skips = new RowOutcomeSkipCollector();
    for (let row = 1; row <= 5000; row++) skips.add('BRAND_NOT_ALLOWED', row * 2, `Brand ${row}`);
    expect(skips.toEntries()[0].topBrands).toHaveLength(20);
  });

  it('accounts for every row in exactly one bucket', () => {
    const skips = new RowOutcomeSkipCollector();
    skips.add('BRAND_NOT_ALLOWED', 2, 'A');
    skips.add('BRAND_NOT_ALLOWED', 3, 'A');
    const entries = [...skips.toEntries(), { outcome: 'IMPORTED' }, { outcome: 'POLICY_HOLD' }, { outcome: 'INVALID' }, { outcome: 'DUPLICATE' }, { outcome: 'OUT_OF_SCOPE' }];
    expect(rowAccounting(entries, 7, policy)).toEqual({ totalRows: 7, eligible: 1, policyExcluded: 2, unresolvedScope: 1, invalid: 1, duplicate: 1, outOfScope: 1, ...policy });
  });

  it('refuses a report that loses a row', () => {
    expect(() => rowAccounting([{ outcome: 'IMPORTED' }], 2, policy)).toThrow('Row accounting mismatch');
  });
});

describe('multipack parsing of real listing names', () => {
  const service = new RowNormalizationService();
  it.each([
    ['Aloe Eva Hair Strengthening Ampoules With Aloe Vera & Moroccan Argan Oil ( 4 Ampoules * 15 Ml )', 15, 'ml', 4],
    ['6 sachets 10 g', 10, 'g', 6],
    ['٤ أمبولات × ١٥ مل', 15, 'ml', 4],
    ['4 x 15 ml', 15, 'ml', 4],
    ['Serum 30 ml', 30, 'ml', null],
    ['Ampoules With Argan Oil 15 ml', 15, 'ml', null],
  ])('%s', (title, size, unit, packCount) => {
    expect(service.extractSizeAndPack(title)).toMatchObject({ size, unit, packCount });
  });
});

describe('row doubts that hold a row before any identity work', () => {
  const service = new RowNormalizationService();
  const row = (overrides: Record<string, unknown>) => service.normalizeRow({ eligibilityApproved: true, sourceRowNumber: 2, supplierSku: 'S-1',
    name: 'Aloe Eva Hair Mask With Silk Proteins 250 Gm', price: 51.26, currency: 'EGP', hasQuantityColumn: true, quantity: 2, ...overrides } as never);

  it('passes a clean purchase-cost row', () => {
    expect(row({ priceType: 'PURCHASE_COST', units: '250 g / Silk' }).holds).toBeUndefined();
  });
  it.each([
    ['a retail price', { priceType: 'RETAIL_REFERENCE' }, 'not a purchase cost'],
    ['a missing price type', { priceType: '' }, 'price type is missing'],
    ['a foreign currency in a row cell', { currency: 'SAR', currencyFromRow: true }, 'no conversion is applied'],
    ['an implausible quantity', { quantity: 999999 }, 'implausibly large'],
    ['a pack naming another variant', { units: '250 g / Yoghurt' }, 'yoghurt'],
    ['a pack stating another unit', { units: '250 ml' }, 'disagrees'],
    ['a pack stating another count', { units: '2 x 250 g' }, 'disagrees'],
  ])('holds %s', (_label, overrides, expected) => {
    const result = row(overrides);
    expect(result.holds?.fields).toBe(true);
    expect((result.statusReason ?? '').toLowerCase()).toContain(expected.toLowerCase());
  });
  it('does not compare a pack description in another script', () => {
    expect(row({ units: '٢٥٠ جم حرير' }).holds).toBeUndefined();
  });
});
