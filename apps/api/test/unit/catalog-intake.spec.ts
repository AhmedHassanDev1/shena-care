import { IntakeRowOutcome } from '@prisma/client';
import type { CatalogIdentitySnapshot, SnapshotSku } from '../../src/modules/catalog/public';
import {
  CandidateIndex, checkObservation, extractPageOffers, identityFingerprint, marketReference, parseAmount, parseBarcode, parseSpreadsheet, readMeasures,
  readSupplierRows, RowIdentity, ScopeGate, supplierColumnProblems,
} from '../../src/modules/intake/public';

const CERAVE = '00000000-0000-4000-8000-0000000000c1';
const ORDINARY = '00000000-0000-4000-8000-0000000000c2';
const LRP = '00000000-0000-4000-8000-0000000000c3';

let n = 0;
const sku = (brandId: string, productName: string, size: number, sizeUnit: string, extra: Partial<SnapshotSku> = {}): SnapshotSku => ({
  skuId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, productId: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, brandId, productName,
  variantName: `${size} ${sizeUnit}`, size, sizeUnit, packCount: 1, barcodes: [], categoryId: null, productType: null, identityStatus: 'EVIDENCE_VERIFIED', sourceUrls: [], isPublished: false, ...extra,
});

const SKUS = {
  hydrating: sku(CERAVE, 'Hydrating Facial Cleanser', 236, 'ml', { barcodes: ['3337875597180'] }),
  foaming: sku(CERAVE, 'Foaming Facial Cleanser', 236, 'ml'),
  cream340: sku(CERAVE, 'Moisturizing Cream', 340, 'g'),
  cream454: sku(CERAVE, 'Moisturizing Cream', 454, 'g', { productId: '10000000-0000-4000-8000-000000000003' }),
  niacinamide: sku(ORDINARY, 'Niacinamide 10% + Zinc 1%', 30, 'ml'),
  hyaluronic: sku(ORDINARY, 'Hyaluronic Acid 2% + B5', 30, 'ml'),
  effaclar: sku(LRP, 'Effaclar Purifying Foaming Gel', 200, 'ml'),
};

const snapshot: CatalogIdentitySnapshot = {
  takenAt: new Date().toISOString(), policyVersion: 1,
  brands: [
    { id: CERAVE, name: 'CeraVe', aliases: [], websiteUrl: 'https://www.cerave.com', policyEffect: 'ALLOW', activeSkuCount: 4 },
    { id: ORDINARY, name: 'The Ordinary', aliases: ['ذا اورديناري'], websiteUrl: null, policyEffect: 'ALLOW', activeSkuCount: 2 },
    { id: LRP, name: 'La Roche-Posay', aliases: ['لاروش بوزيه'], websiteUrl: null, policyEffect: 'ALLOW', activeSkuCount: 1 },
  ],
  deniedLabels: ['Bioderma'], categories: [], skus: Object.values(SKUS),
};

const row = (name: string, extra: Partial<RowIdentity> = {}): RowIdentity => {
  const reading = readMeasures(name);
  const measure = reading.measures.length === 1 ? { size: reading.measures[0].size, unit: reading.measures[0].unit } : null;
  return { name, barcode: null, code: null, measure, measureConflict: reading.measures.length > 1, packCount: reading.packCount, fingerprint: identityFingerprint(name, measure, reading.packCount), ...extra };
};

describe('Catalog Intake — cheap reading', () => {
  it('reads Egyptian price cells and refuses ranges', () => {
    expect(parseAmount('١٬٢٥٠٫٥٠')).toBe(1250.5);
    expect(parseAmount('250 ج.م')).toBe(250);
    expect(parseAmount('EGP 99,50')).toBe(99.5);
    expect(parseAmount('1,250')).toBe(1250);
    expect(parseAmount('100-120')).toBeNull();
    expect(parseAmount('اتصل')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('reads sizes, units and packs in Arabic and English', () => {
    expect(readMeasures('سيرافي غسول ٢٣٦ مل').measures[0]).toMatchObject({ size: 236, unit: 'ml' });
    expect(readMeasures('كريم 50جم').measures[0]).toMatchObject({ size: 50, unit: 'g' });
    expect(readMeasures('Serum 2 x 30ml').packCount).toBe(2);
    expect(readMeasures('لوشن 400 مل عرض 2').packCount).toBe(2);
    expect(readMeasures('Cream 50ml / 100ml').measures).toHaveLength(2);
    expect(parseBarcode('3337875597180')).toBe('3337875597180');
    expect(parseBarcode('3.33788E+12')).toBeNull();
  });

  it('maps Arabic supplier headers (BOM, semicolons) and derives purchase price from consumer price and discount', () => {
    const csv = '﻿اسم الصنف;سعر الجمهور;خصم %;الكود;الرصيد\nسيرافي غسول مرطب 236 مل;٨٥٠;20;CV-01;12\nسيرافي غسول مرطب 236 مل;850;20;CV-01;12\nكريم مجهول 50 مل;300;10;X1;0\nكريم مجهول 50 مل;320;10;X1;0\n;100;10;;\n';
    const sheet = parseSpreadsheet(Buffer.from(csv, 'utf8'), 'list.csv', 'text/csv');
    expect(sheet.columnMap).toMatchObject({ name: 0, consumerPrice: 1, discountPercent: 2, code: 3, quantity: 4 });
    expect(supplierColumnProblems(sheet.columnMap)).toEqual([]);
    const rows = readSupplierRows(sheet);
    expect(rows[0]).toMatchObject({ purchasePrice: 680, consumerPrice: 850, supplierCode: 'CV-01', quantity: 12 });
    expect(rows[1]).toMatchObject({ outcome: IntakeRowOutcome.SKIPPED, reasonCode: 'DUPLICATE_ROW' });
    expect(rows[2]).toMatchObject({ outcome: IntakeRowOutcome.INVALID, reasonCode: 'CONFLICTING_DUPLICATE' });
    expect(rows[3]).toMatchObject({ outcome: IntakeRowOutcome.INVALID, reasonCode: 'CONFLICTING_DUPLICATE' });
    expect(rows[4]).toMatchObject({ outcome: IntakeRowOutcome.INVALID, reasonCode: 'NAME_MISSING' });
  });

  it('asks which price a lone "price" column is instead of guessing', () => {
    const sheet = parseSpreadsheet(Buffer.from('Product,Price\nCeraVe cream 454g,900\n'), 'x.csv', 'text/csv');
    expect(supplierColumnProblems(sheet.columnMap)[0].code).toBe('PRICE_TYPE_AMBIGUOUS');
    const mapped = parseSpreadsheet(Buffer.from('Product,Price\nCeraVe cream 454g,900\n'), 'x.csv', 'text/csv', { purchasePrice: 1 });
    expect(supplierColumnProblems(mapped.columnMap)).toEqual([]);
  });
});

describe('Catalog Intake — fast scope gate (safe negatives only)', () => {
  const index = new CandidateIndex(snapshot, new Map(), new Map());
  const gate = new ScopeGate(snapshot);
  const decide = (name: string) => gate.decide({ name, catalogBrands: index.brands.detect(name), hardIdentifier: index.hardHits(row(name)).length > 0 });

  it('skips proven out-of-scope classes and policy-denied brands', () => {
    expect(decide('بانادول اكسترا 24 قرص')).toMatchObject({ decision: 'SKIP', reasonCode: 'OUT_OF_SCOPE_MEDICINE' });
    expect(decide('Pampers diapers size 4')).toMatchObject({ decision: 'SKIP', reasonCode: 'OUT_OF_SCOPE_BABY_FEEDING_DIAPERS' });
    expect(decide('عطر رجالي 100 مل')).toMatchObject({ decision: 'SKIP', reasonCode: 'OUT_OF_SCOPE_FRAGRANCE' });
    expect(decide('Bioderma Sensibio H2O 250ml')).toMatchObject({ decision: 'SKIP', reasonCode: 'POLICY_BRAND_DENIED' });
  });

  it('never skips a catalog brand, a mouthwash-free cleanser, or an unknown brand', () => {
    expect(decide('سيرافي غسول مرطب 236 مل').decision).toBe('CONTINUE');
    expect(decide('Garnier micellar water 400ml').decision).toBe('CONTINUE');
    expect(decide('غسول فم ليسترين 250 مل')).toMatchObject({ decision: 'SKIP', reasonCode: 'OUT_OF_SCOPE_ORAL_CARE' });
  });

  it('never skips a row a barcode identifies', () => {
    expect(gate.decide({ name: 'اقراص', catalogBrands: [], hardIdentifier: true }).decision).toBe('CONTINUE');
  });
});

describe('Catalog Intake — Arabic/English identity matching', () => {
  const index = new CandidateIndex(snapshot, new Map([['cv-02', SKUS.foaming.skuId]]), new Map());
  const match = (name: string, extra: Partial<RowIdentity> = {}) => index.match(row(name, extra));

  it('links Arabic supplier wording to the English canonical SKU (phonetic brand, vocabulary facts, size)', () => {
    expect(match('سيرافي غسول مرطب للبشرة العادية الى الجافة 236 مل')).toMatchObject({ kind: 'MATCH', skuId: SKUS.hydrating.skuId });
    expect(match('سيرافي كريم مرطب 340 جم')).toMatchObject({ kind: 'MATCH', skuId: SKUS.cream340.skuId });
    expect(match('CeraVe Foaming Cleanser 236ml')).toMatchObject({ kind: 'MATCH', skuId: SKUS.foaming.skuId });
    expect(match('ذا اورديناري سيروم نياسيناميد 10% زنك 30 مل')).toMatchObject({ kind: 'MATCH', skuId: SKUS.niacinamide.skuId });
    expect(match('The ordinary hyaluronic acid serum 30 ml')).toMatchObject({ kind: 'MATCH', skuId: SKUS.hyaluronic.skuId });
  });

  it('matches a reviewed Shaan antioxidant cleanser translation without relaxing size checks', () => {
    const shaan = '00000000-0000-4000-8000-0000000000c4';
    const cleanser = sku(shaan, 'Antioxidant Facial Cleanser', 250, 'ml');
    const cream = sku(shaan, 'Rejuvenation Cream', 120, 'g');
    const index = new CandidateIndex({
      ...snapshot,
      brands: [{ id: shaan, name: 'Shaan', aliases: ['شان'], websiteUrl: null, policyEffect: 'ALLOW', activeSkuCount: 2 }],
      skus: [cleanser, cream],
    }, new Map(), new Map());
    expect(index.match(row('شان غسول مضاد للأكسدة 250 مل'))).toMatchObject({ kind: 'MATCH', skuId: cleanser.skuId });
    expect(index.match(row('Shaan شان غسول مضاد للأكسدة 250 مل'))).toMatchObject({ kind: 'MATCH', skuId: cleanser.skuId });
    expect(index.match(row('شان غسول مضاد للأكسدة 120 جم')).kind).not.toBe('MATCH');
  });

  it('treats 236 ml and 237 ml as one bottle, but never links another size', () => {
    expect(match('CeraVe Hydrating Cleanser 237ml')).toMatchObject({ kind: 'MATCH', skuId: SKUS.hydrating.skuId });
    expect(match('سيرافي كريم مرطب 177 مل')).toMatchObject({ kind: 'NONE' });
    expect(match('CeraVe Hydrating Cleanser 473ml')).toMatchObject({ kind: 'NONE', reasonCode: 'SIZE_NOT_IN_CATALOG' });
  });

  it('refuses a different strength', () => {
    expect(match('The Ordinary Niacinamide 5% 30ml').kind).not.toBe('MATCH');
  });

  it('sends close calls and missing sizes to critical review, never a guess', () => {
    expect(match('سيرافي غسول 236 مل')).toMatchObject({ kind: 'AMBIGUOUS' });
    expect(match('سيرافي كريم مرطب')).toMatchObject({ kind: 'AMBIGUOUS', reasonCode: 'SIZE_NOT_STATED' });
  });

  it('uses barcode and supplier code, and flags a barcode the wording contradicts', () => {
    expect(match('غسول 236 مل', { barcode: '3337875597180' })).toMatchObject({ kind: 'MATCH', skuId: SKUS.hydrating.skuId, basis: 'BARCODE' });
    expect(match('منتج 236 مل', { code: 'CV-02' })).toMatchObject({ kind: 'MATCH', skuId: SKUS.foaming.skuId, basis: 'SUPPLIER_CODE' });
    expect(match('CeraVe Hydrating Cleanser 473ml', { barcode: '3337875597180' })).toMatchObject({ kind: 'CONFLICT', reasonCode: 'BARCODE_CONTRADICTED' });
  });

  it('finds a product line without its brand only on a distinctive word', () => {
    expect(match('Effaclar purifying foaming gel 200ml')).toMatchObject({ kind: 'MATCH', skuId: SKUS.effaclar.skuId, basis: 'BRANDLESS_PRODUCT_LINE' });
    expect(match('Hydrating cleanser 236ml')).toMatchObject({ kind: 'NONE', reasonCode: 'NO_KNOWN_BRAND' });
  });

  it('learned wording is reused on the next file', () => {
    const first = row('سيرافي غسول مرطب 236 مل');
    const learnedIndex = new CandidateIndex(snapshot, new Map(), new Map([[first.fingerprint, SKUS.hydrating.skuId]]));
    expect(learnedIndex.match(first)).toMatchObject({ kind: 'MATCH', basis: 'LEARNED_ALIAS' });
  });
});

describe('Catalog Intake — market price evidence', () => {
  const page = (offer: Record<string, unknown>, name = 'CeraVe Hydrating Facial Cleanser 236ml') =>
    `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', ...offer } })}</script></html>`;
  const expected = { size: 236, sizeUnit: 'ml', barcode: null, productName: 'Hydrating Facial Cleanser' };

  it('reads offer price, currency, list price and stock from structured data only', () => {
    const [offer] = extractPageOffers(page({ price: '780.00', priceCurrency: 'EGP', availability: 'https://schema.org/InStock',
      priceSpecification: { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/StrikethroughPrice', price: 950 } }));
    expect(offer).toMatchObject({ price: 780, currency: 'EGP', regularPrice: 950, inStock: true });
    expect(extractPageOffers('<html><p>Price 500 EGP</p></html>')).toEqual([]);
  });

  it('accepts only exact-SKU EGP prices', () => {
    const ok = extractPageOffers(page({ price: 780, priceCurrency: 'EGP' }))[0];
    expect(checkObservation(ok, expected, { identityMatched: true, sellerTrust: 'TRUSTED_RETAILER' }).accepted).toBe(true);
    expect(checkObservation(ok, expected, { identityMatched: false, sellerTrust: 'TRUSTED_RETAILER' }).reason).toBe('PAGE_IS_ANOTHER_PRODUCT');
    const usd = extractPageOffers(page({ price: 15, priceCurrency: 'USD' }))[0];
    expect(checkObservation(usd, expected, { identityMatched: true, sellerTrust: 'TRUSTED_RETAILER' }).reason).toBe('CURRENCY_USD');
    const bundle = extractPageOffers(page({ price: 1400, priceCurrency: 'EGP' }, 'CeraVe Hydrating Cleanser 236ml x2 bundle'))[0];
    expect(checkObservation(bundle, expected, { identityMatched: true, sellerTrust: 'TRUSTED_RETAILER' }).accepted).toBe(false);
    const big = extractPageOffers(page({ price: 1200, priceCurrency: 'EGP' }, 'CeraVe Hydrating Facial Cleanser 473ml'))[0];
    expect(checkObservation(big, expected, { identityMatched: true, sellerTrust: 'TRUSTED_RETAILER' }).reason).toBe('SIZE_DIFFERS');
  });

  it('builds an advisory range from one fresh price per seller, outliers excluded', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    const at = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const reference = marketReference([
      { id: 'a', sellerDomain: 'a.eg', priceEgp: 780, regularPriceEgp: 950, observedAt: at(1), confidence: 0.85 },
      { id: 'a-old', sellerDomain: 'a.eg', priceEgp: 700, regularPriceEgp: null, observedAt: at(3), confidence: 0.85 },
      { id: 'b', sellerDomain: 'b.eg', priceEgp: 820, regularPriceEgp: null, observedAt: at(2), confidence: 0.85 },
      { id: 'c', sellerDomain: 'c.eg', priceEgp: 260, regularPriceEgp: null, observedAt: at(2), confidence: 0.65 },
      { id: 'd', sellerDomain: 'd.eg', priceEgp: 800, regularPriceEgp: null, observedAt: at(40), confidence: 0.85 },
    ], now, 14)!;
    expect(reference).toMatchObject({ minEgp: 780, maxEgp: 820, sellers: 2 });
    expect(reference.excluded.map(item => `${item.id}:${item.reason}`).sort()).toEqual(['a-old:OLDER_FROM_SAME_LISTING', 'c:OUTLIER', 'd:STALE']);
  });
});
