// GLO-275 Gate 03 — typed row validation: strict quantities, money, discounts and confident-only scope exclusion (no database).
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { NormalizedRowStatus, DiscountType } from '../../src/modules/ingestion/contracts/row-normalization.contract';
import { QuantityPresence } from '../../src/modules/ingestion/contracts/canonical-supplier-record.contract';

const rows = new RowNormalizationService();
const row = (overrides: Record<string, unknown>) => rows.normalizeRow({
  sourceRowNumber: 2, supplierSku: 'S-1', name: 'CeraVe Hydrating Cleanser 236ml', brand: 'CeraVe',
  price: '100.00', currency: 'EGP', hasQuantityColumn: true, ...overrides,
} as Parameters<RowNormalizationService['normalizeRow']>[0]);

describe('GLO-275 Gate 03: strict quantity semantics', () => {
  // A number cell (-5), a text cell ('-5') and a spaced sign ('- 3').
  it.each([-5, '-5', '- 3'])('rejects a negative quantity %p instead of turning it into stock', quantity => {
    const result = row({ quantity });
    expect(result.status).toBe(NormalizedRowStatus.INVALID);
    expect(result.inventory.reportedQuantity).toBeNull();
  });

  it.each([12.5, '12.5', '3-5', '5 boxes', '1/2', 'كرتونة 6'])('holds a non-integer or unit-bearing quantity %p for review without inventing stock', quantity => {
    const result = row({ quantity });
    expect(result.status).toBe(NormalizedRowStatus.REVIEW);
    expect(result.inventory.reportedQuantity).toBeNull();
    expect(result.inventory.isInStock).toBeNull();
  });

  it.each([
    ['17', 17], [17, 17], ['1,200', 1200], ['١٢', 12], ['١٬٢٠٠', 1200], ['8.0', 8], [' 40 ', 40],
  ])('reads %p as exactly %p units', (quantity, expected) => {
    const result = row({ quantity });
    expect(result.status).toBe(NormalizedRowStatus.UPDATED_CANDIDATE);
    expect(result.inventory).toMatchObject({ presence: QuantityPresence.EXPLICIT, reportedQuantity: expected, isInStock: true });
  });

  it('keeps explicit zero, unknown blank and missing column distinct', () => {
    expect(row({ quantity: 0 }).inventory).toMatchObject({ presence: QuantityPresence.ZERO, reportedQuantity: 0, isInStock: false });
    expect(row({ quantity: '٠' }).inventory).toMatchObject({ presence: QuantityPresence.ZERO, reportedQuantity: 0 });
    expect(row({ quantity: '' }).inventory).toMatchObject({ presence: QuantityPresence.UNKNOWN, reportedQuantity: null });
    expect(row({ quantity: undefined, hasQuantityColumn: false }).inventory)
      .toMatchObject({ presence: QuantityPresence.MISSING, reportedQuantity: null });
  });
});

describe('GLO-275 Gate 03: purchase cost and discounts', () => {
  it('reads Arabic-Indic digits and the Arabic decimal separator in money', () => {
    expect(row({ price: '٣٩٥٫٢٠' }).pricing.purchaseCost).toBe(395.2);
    expect(row({ price: 'EGP ١٬٢٣٤٫٥٠' }).pricing.purchaseCost).toBe(1234.5);
  });

  it('never manufactures a cost from a retail price alone, or from zero/negative/garbled prices', () => {
    expect(row({ price: undefined, retailPrice: '200' }).status).toBe(NormalizedRowStatus.INVALID);
    for (const price of ['0', 0, '-20', 'NaN', '1.234,50']) expect(row({ price }).status).toBe(NormalizedRowStatus.INVALID);
  });

  it('rejects signed or out-of-range discounts instead of dropping the sign', () => {
    expect(row({ price: undefined, retailPrice: '200', discount: '-10%' }).status).toBe(NormalizedRowStatus.INVALID);
    expect(row({ price: undefined, retailPrice: '200', discount: '150%' }).status).toBe(NormalizedRowStatus.INVALID);
  });

  it('does not derive cost from a bare discount number whose unit is unknown', () => {
    const result = row({ price: undefined, retailPrice: '200', discount: '15' });
    expect(result.status).toBe(NormalizedRowStatus.INVALID);
    expect(result.statusReason).toMatch(/discount unit/i);
  });

  it('derives cost only with an explicit discount unit', () => {
    expect(row({ price: undefined, retailPrice: '205', discount: '18%' }).pricing.purchaseCost).toBe(168.1);
    expect(row({ price: undefined, retailPrice: '205', discount: '18', discountBasis: 'PERCENT' }).pricing.purchaseCost).toBe(168.1);
    expect(row({ price: undefined, retailPrice: '205', discount: '5', discountBasis: 'AMOUNT_PER_UNIT' }).pricing)
      .toMatchObject({ purchaseCost: 200, discount: { type: DiscountType.FIXED_AMOUNT, value: 5 } });
  });

  it('holds for review when an explicit cost contradicts retail minus discount', () => {
    const result = row({ price: '100', retailPrice: '200', discount: '10%' });
    expect(result.status).toBe(NormalizedRowStatus.REVIEW);
    expect(result.pricing.purchaseCost).toBe(100);
    expect(row({ price: '180', retailPrice: '200', discount: '10%' }).status).toBe(NormalizedRowStatus.UPDATED_CANDIDATE);
  });
});

describe('GLO-275 Gate 03: scope — skip only confident exclusions', () => {
  it.each([
    'Green Tea Purifying Cleanser 150ml', 'Rice Water Brightening Toner', 'Sugar Lip Scrub', 'Coffee Body Scrub 200g',
    'غسول بالشاي الاخضر', 'Steam Cream 75ml', 'Cabbage Soothing Cream',
  ])('does not exclude skincare whose name contains an ingredient or food word: %s', name => {
    const result = row({ name });
    expect(result.status).not.toBe(NormalizedRowStatus.OUT_OF_SCOPE);
    expect(result.scope.category).not.toBe('excluded');
  });

  it.each(['Phone Charger Cable 1m', 'Cotton Shirt XL', 'شاحن موبايل', 'Instant Pasta 400g'])('confidently excludes %s', name => {
    expect(row({ name, brand: 'Generic Goods' }).status).toBe(NormalizedRowStatus.OUT_OF_SCOPE);
  });

  it.each(['La Roche-Posay Toleriane Lipstick', 'Vichy Eau de Parfum 50ml', 'روج مات', 'Mascara Volume Black'])(
    'excludes makeup and perfume even under a skincare brand: %s', name => {
      expect(row({ name, brand: 'La Roche-Posay' }).status).toBe(NormalizedRowStatus.OUT_OF_SCOPE);
    });

  it('holds conflicting product-type signals for review', () => {
    expect(row({ name: 'Tinted Foundation SPF 30', brand: 'Vichy' }).status).toBe(NormalizedRowStatus.REVIEW);
  });

  it('holds a food/ingredient word with no product type for review rather than skipping it', () => {
    expect(row({ name: 'Coffee Extract 250ml', brand: 'Unknown Lab' }).status).toBe(NormalizedRowStatus.REVIEW);
  });

  it('recognises coffee eye patches as skincare even with an unknown brand (GLO-281)', () => {
    expect(row({ name: 'Coffee Eye Patches', brand: 'Unknown Lab' }).status).not.toBe(NormalizedRowStatus.OUT_OF_SCOPE);
    expect(rows.classifyScope('Coffee Eye Patches', 'Unknown Lab').category).toBe('skincare');
  });

  it('still recognises plain skincare and haircare', () => {
    expect(row({ name: 'Vichy Dercos Anti-Dandruff Shampoo 200ml', brand: 'Vichy' }).scope.category).toBe('haircare');
    expect(row({ name: 'Effaclar Duo+ Cream 40ml', brand: 'La Roche-Posay' }).scope.category).toBe('skincare');
  });
});

describe('GLO-275/276: why a REVIEW row is held decides whether it may still be matched', () => {
  it('marks an unrecognised-category row as a scope-only hold', () => {
    expect(row({ name: 'كلينزر هيدرا كالم ٢٠٠ مل', brand: 'Unlisted Lab' }).holds).toEqual({ scope: true, fields: false });
  });

  it('marks quantity/price doubts as field holds even when the category is clear', () => {
    expect(row({ quantity: '5 boxes' }).holds).toEqual({ scope: false, fields: true });
    expect(row({ name: 'كلينزر هيدرا', brand: 'Unlisted Lab', quantity: '12.5' }).holds).toEqual({ scope: true, fields: true });
    expect(row({}).holds).toBeUndefined();
  });
});
