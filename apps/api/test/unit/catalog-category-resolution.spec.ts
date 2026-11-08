import { compileEligibilityPolicy, EligibilityDocument } from '../../src/modules/ingestion/services/ingestion-eligibility.policy';
import { readProductType } from '../../src/modules/ingestion/services/product-type';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { sameUrl } from '../../src/modules/ingestion/services/catalog-decision-engine';

// The shape of the approved Policy v14 taxonomy (Skin Care / Hair Care leaves, brand-scoped leaf allowlists).
const C = { skin: 'c-skin', hair: 'c-hair', moist: 'c-moist', clean: 'c-clean', sun: 'c-sun', serum: 'c-serum', shampoo: 'c-shampoo', cond: 'c-cond', treat: 'c-treat' };
const doc: EligibilityDocument = {
  resolutionVersion: 2,
  brands: [
    { id: 'b-cerave', name: 'Cerave', isActive: true, effect: 'ALLOW', aliases: [], categoryIds: [C.moist, C.clean] },
    { id: 'b-capixy', name: 'capixy', isActive: true, effect: 'ALLOW', aliases: [], categoryIds: [C.cond, C.shampoo] },
    { id: 'b-clary', name: 'Clary Corporation', isActive: true, effect: 'ALLOW', aliases: ['clary'], categoryIds: [C.shampoo, C.cond, C.treat] },
    { id: 'b-eva', name: 'Eva Cosmetics', isActive: true, effect: null, aliases: [], categoryIds: [] },
  ],
  categories: [
    { id: C.skin, name: 'Skin Care', parentId: null, isActive: true, effect: null },
    { id: C.hair, name: 'Hair Care', parentId: null, isActive: true, effect: null },
    { id: C.moist, name: 'Moisturizers', parentId: C.skin, isActive: true, effect: null },
    { id: C.clean, name: 'Cleansers', parentId: C.skin, isActive: true, effect: null },
    { id: C.sun, name: 'Sunscreens', parentId: C.skin, isActive: true, effect: null },
    { id: C.serum, name: 'Serums & Treatments', parentId: C.skin, isActive: true, effect: null },
    { id: C.shampoo, name: 'Shampoos', parentId: C.hair, isActive: true, effect: null },
    { id: C.cond, name: 'Conditioners', parentId: C.hair, isActive: true, effect: null },
    { id: C.treat, name: 'Hair Treatments & Styling', parentId: C.hair, isActive: true, effect: null },
  ],
  mappings: [],
};
const policy = compileEligibilityPolicy({ id: 'p', version: 14, document: doc });
const row = (name: string, brand: string, category = '') => policy.evaluate('', brand, category, name);

describe('product type reading (Arabic, Egyptian colloquial, English)', () => {
  it.each([
    ['Clary Hair Shampoo', 'shampoo'], ['كلاري شامبو شعر', 'shampoo'], ['شامبوهات', 'shampoo'], ['بلسم كابيكسي للشعر', 'conditioner'], ['Capixy Hair Hydrating Conditioner', 'conditioner'],
    ['Clary Hair Mask', 'hair-mask'], ['ماسك للشعر', 'hair-mask'], ['حمام كريم', 'hair-mask'], ['CeraVe Foaming Cleanser', 'cleanser'], ['غسول رغوي للبشرة الدهنية', 'cleanser'],
    ['فيس واش', 'cleanser'], ['Hydrating Toner', 'toner'], ['Vitamin C Serum', 'serum'], ['واقي شمس', 'sunscreen'], ['صن بلوك SPF50', 'sunscreen'],
    ['CeraVe Moisturising Cream', 'moisturizer'], ['كريم مرطب', 'moisturizer'], ['Micellar Water', 'makeup-remover'], ['مزيل مكياج', 'makeup-remover'], ['Eye Repair Cream', 'eye-care'],
  ])('%s -> %s', (name, type) => {
    expect(readProductType(name).types.map(t => t.key)).toEqual([type]);
  });

  it('keeps a precise subtype when the phrase states it', () => {
    expect(readProductType('CeraVe Foaming Cleanser').types[0].subtype).toBe('foaming');
  });

  it('reports two types for a 2-in-1 instead of choosing one', () => {
    expect(readProductType('Shampoo & Conditioner 2in1').types.map(t => t.key).sort()).toEqual(['conditioner', 'shampoo']);
  });

  it('reads nothing from a name with no type word', () => {
    expect(readProductType('CeraVe 236ml').types).toEqual([]);
  });

  it('a generic "cream" only counts with nothing more precise, and takes its area from the name', () => {
    expect(readProductType('Hydrating Cleanser cream-to-foam').types.map(t => t.key)).toEqual(['cleanser']);
    expect(readProductType('كريم شعر').types.map(t => t.key)).toEqual(['hair-styling']);
  });
});

describe('Catalog Policy leaf category from the product type (supplier category missing or different)', () => {
  it('resolves the approved leaf from the name when the category cell is empty (root cause of POLICY_CATEGORY_UNKNOWN)', () => {
    expect(row('Clary Hair Shampoo', 'Clary')).toMatchObject({ outcome: 'ALLOW', categoryId: C.shampoo, category: { basis: 'PRODUCT_TYPE', productType: 'shampoo' } });
    expect(row('كلاري شامبو شعر', 'Clary')).toMatchObject({ outcome: 'ALLOW', categoryId: C.shampoo });
    expect(row('CeraVe Moisturising Cream', 'CeraVe')).toMatchObject({ outcome: 'ALLOW', categoryId: C.moist });
    expect(row('Clary Hair Mask', 'Clary')).toMatchObject({ outcome: 'ALLOW', categoryId: C.treat });
  });

  it('never authorises a leaf through its parent: a type the brand is not allowed stays SKIP', () => {
    expect(row('CeraVe Shampoo', 'CeraVe')).toMatchObject({ outcome: 'SKIP', reason: 'CATEGORY_NOT_ALLOWED_FOR_BRAND' });
    expect(row('Capixy Hair Mask', 'Capixy')).toMatchObject({ outcome: 'SKIP', reason: 'CATEGORY_NOT_ALLOWED_FOR_BRAND' });
    expect(row('Some Serum', 'Eva Cosmetics')).toMatchObject({ outcome: 'SKIP', reason: 'BRAND_NOT_ALLOWED' });
  });

  it('a parent category cell is narrowed by the type, inside that parent only', () => {
    expect(row('CeraVe Hydrating Cleanser', 'CeraVe', 'Skin Care')).toMatchObject({ outcome: 'ALLOW', categoryId: C.clean, category: { basis: 'STATED_PARENT_AND_TYPE' } });
    expect(row('CeraVe Hydrating Cleanser', 'CeraVe', 'Hair Care')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_CONFLICTS_PRODUCT_TYPE' });
    expect(row('CeraVe 236ml', 'CeraVe', 'Skin Care')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_REQUIRES_LEAF' });
  });

  it('a stated leaf that the name contradicts is a conflict, never trusted silently', () => {
    expect(row('CeraVe Shampoo', 'CeraVe', 'Cleansers')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_CONFLICTS_PRODUCT_TYPE' });
    // Both readings are excluded for the brand: a definite SKIP, nobody needs to look.
    expect(row('Capixy Cleanser', 'Capixy', 'Hair Treatments & Styling')).toMatchObject({ outcome: 'SKIP' });
  });

  it('a consistent stated leaf keeps its label basis', () => {
    expect(row('CeraVe Moisturising Lotion', 'Cerave', 'Moisturizers')).toMatchObject({ outcome: 'ALLOW', categoryId: C.moist, category: { basis: 'STATED_LABEL' } });
  });

  it('ambiguous types are never settled by preference; a definite exclusion for every reading is a SKIP', () => {
    expect(row('Clary Shampoo & Conditioner 2in1', 'Clary')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_AMBIGUOUS' });
    expect(row('CeraVe Shampoo & Conditioner', 'CeraVe')).toMatchObject({ outcome: 'SKIP' });
  });

  it('a type with no approved leaf in the taxonomy is an early SKIP; an unreadable name is still unknown', () => {
    expect(row('CeraVe Toner', 'CeraVe')).toMatchObject({ outcome: 'SKIP', reason: 'PRODUCT_TYPE_NOT_IN_TAXONOMY' });
    expect(row('CeraVe 236ml', 'CeraVe')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_UNKNOWN' });
  });

  it('without a product name the original exact-label semantics are unchanged', () => {
    expect(policy.evaluate('', 'Clary', '')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_UNKNOWN' });
    expect(policy.evaluate('', 'Clary', 'Shampoos')).toMatchObject({ outcome: 'ALLOW', categoryId: C.shampoo });
  });

  it('brandOf resolves names and approved aliases, never spelling guesses', () => {
    expect(policy.brandOf('clary')).toMatchObject({ id: 'b-clary', name: 'Clary Corporation', effect: 'ALLOW' });
    expect(policy.brandOf('Capixxy')).toBeUndefined();
  });
});

describe('barcode claims and page identity', () => {
  const normalizer = new RowNormalizationService();
  it('rejects placeholder barcodes that happen to pass the check digit', () => {
    expect(normalizer.normalizeBarcode('0000000000000').isValid).toBe(false);
    expect(normalizer.normalizeBarcode('00000000').isValid).toBe(false);
    expect(normalizer.normalizeBarcode('6224008073666').isValid).toBe(true);
  });
  it('treats a storefront collection path as the same product page', () => {
    expect(sameUrl('https://eparkville.com/collections/buy-one-get-one/products/clary-hair-mask-300ml', 'https://eparkville.com/products/clary-hair-mask-300ml')).toBe(true);
    expect(sameUrl('https://eparkville.com/products/clary-hair-mask-300ml', 'https://eparkville.com/products/clary-hair-shampoo-300ml')).toBe(false);
  });
});
