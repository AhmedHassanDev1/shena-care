import { compileEligibilityPolicy, EligibilityDocument } from '../../src/modules/ingestion/services/ingestion-eligibility.policy';

/** Brand-scoped leaves and product exclusions: one rule engine for text-stated rows and identity-resolved rows. */
describe('Catalog Policy rules', () => {
  const doc = (overrides: Partial<EligibilityDocument> = {}): EligibilityDocument => ({
    resolutionVersion: 2,
    brands: [
      { id: 'b-cerave', name: 'CeraVe', isActive: true, effect: 'ALLOW', aliases: ['سيرافي'], categoryIds: ['c-cleanser', 'c-moist'] },
      { id: 'b-vichy', name: 'Vichy', isActive: true, effect: 'ALLOW', aliases: [], categoryIds: ['c-shampoo'] },
      { id: 'b-legacy', name: 'Eva', isActive: true, effect: 'ALLOW', aliases: [] },
      { id: 'b-off', name: 'Nivea', isActive: true, effect: null, aliases: [] },
      { id: 'b-empty', name: 'Bioderma', isActive: true, effect: 'ALLOW', aliases: [], categoryIds: [] },
    ],
    categories: [
      { id: 'c-skin', name: 'Skin Care', parentId: null, isActive: true, effect: null },
      { id: 'c-cleanser', name: 'Cleansers', parentId: 'c-skin', isActive: true, effect: null },
      { id: 'c-moist', name: 'Moisturizers', parentId: 'c-skin', isActive: true, effect: null },
      { id: 'c-sun', name: 'Sunscreens', parentId: 'c-skin', isActive: true, effect: 'ALLOW' },
      { id: 'c-hair', name: 'Hair Care', parentId: null, isActive: true, effect: null },
      { id: 'c-shampoo', name: 'Shampoos', parentId: 'c-hair', isActive: true, effect: null },
      { id: 'c-makeup', name: 'Makeup', parentId: null, isActive: true, effect: null },
    ],
    mappings: [],
    exclusions: [{ productId: 'p-excluded', brandId: 'b-cerave', name: 'CeraVe Old Cleanser', reason: 'Discontinued', actorId: 'a', at: '2026-11-05T00:00:00Z' }],
    ...overrides,
  });
  const policy = (d = doc()) => compileEligibilityPolicy({ id: 'p1', version: 7, document: d });

  it('admits a brand only for its own leaves', () => {
    const p = policy();
    expect(p.evaluate('', 'CeraVe', 'Cleansers')).toMatchObject({ outcome: 'ALLOW', brandId: 'b-cerave', categoryId: 'c-cleanser', version: 7 });
    expect(p.evaluate('', 'سيرافي', 'Moisturizers')).toMatchObject({ outcome: 'ALLOW', brandId: 'b-cerave' });
    // Shampoos are allowed for Vichy, not for CeraVe.
    expect(p.evaluate('', 'CeraVe', 'Shampoos')).toMatchObject({ outcome: 'SKIP', reason: 'CATEGORY_NOT_ALLOWED_FOR_BRAND' });
    expect(p.evaluate('', 'Vichy', 'Shampoos')).toMatchObject({ outcome: 'ALLOW', categoryId: 'c-shampoo' });
  });

  it('skips a disabled brand and a category no enabled brand allows, before anything else', () => {
    const p = policy();
    expect(p.evaluate('', 'Nivea', 'Cleansers')).toMatchObject({ outcome: 'SKIP', reason: 'BRAND_NOT_ALLOWED' });
    expect(p.evaluate('', 'Unknown Brand', 'Makeup')).toMatchObject({ outcome: 'SKIP', reason: 'CATEGORY_NOT_ALLOWED' });
    // Allowed for some brand, so an unknown brand cannot be skipped on category alone.
    expect(p.evaluate('', 'Unknown Brand', 'Shampoos')).toMatchObject({ outcome: 'HOLD', reason: 'BRAND_UNKNOWN' });
    expect(p.evaluate('', 'Unknown Brand', 'Skin Care')).toMatchObject({ outcome: 'HOLD', reason: 'BRAND_UNKNOWN' });
    // A leaf outside every list is a definite exclusion even with an unknown brand.
    const noSun = policy(doc({ categories: doc().categories.map(c => c.id === 'c-sun' ? { ...c, effect: null } : c) }));
    expect(noSun.evaluate('', 'Unknown Brand', 'Sunscreens')).toMatchObject({ outcome: 'SKIP', reason: 'CATEGORY_NOT_ALLOWED' });
  });

  it('holds unknown or imprecise categories and never lets a parent approve its children', () => {
    const p = policy();
    expect(p.evaluate('', 'CeraVe', '')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_UNKNOWN' });
    expect(p.evaluate('', 'CeraVe', 'Face stuff')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_UNKNOWN' });
    expect(p.evaluate('', 'CeraVe', 'Skin Care')).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_REQUIRES_LEAF' });
    // An enabled brand with no categories yet admits nothing.
    expect(p.evaluate('', 'Bioderma', 'Cleansers')).toMatchObject({ outcome: 'SKIP', reason: 'CATEGORY_NOT_ALLOWED_FOR_BRAND' });
  });

  it('keeps the central leaf list for a brand configured before brand scoping', () => {
    const p = policy();
    expect(p.evaluate('', 'Eva', 'Sunscreens')).toMatchObject({ outcome: 'ALLOW', brandId: 'b-legacy' });
    expect(p.evaluate('', 'Eva', 'Cleansers')).toMatchObject({ outcome: 'SKIP', reason: 'CATEGORY_NOT_ALLOWED_FOR_BRAND' });
  });

  it('judges identity-resolved rows by the canonical product, with exclusions winning', () => {
    const p = policy();
    expect(p.evaluateIdentity({ productId: 'p-excluded', brandId: 'b-cerave', categoryId: 'c-cleanser' })).toMatchObject({ outcome: 'SKIP', reason: 'PRODUCT_EXCLUDED', productId: 'p-excluded' });
    expect(p.evaluateIdentity({ productId: 'p-ok', brandId: 'b-cerave', categoryId: 'c-cleanser' })).toMatchObject({ outcome: 'ALLOW', productId: 'p-ok' });
    expect(p.evaluateIdentity({ productId: 'p-2', brandId: 'b-cerave', categoryId: null })).toMatchObject({ outcome: 'HOLD', reason: 'CATEGORY_UNKNOWN' });
    expect(p.evaluateIdentity({ productId: 'p-3', brandId: 'b-off', categoryId: 'c-cleanser' })).toMatchObject({ outcome: 'SKIP', reason: 'BRAND_NOT_ALLOWED' });
    expect(p.isExcluded('p-excluded')).toBe(true);
  });

  it('holds everything when no policy is active', () => {
    const p = compileEligibilityPolicy(null);
    expect(p.evaluate('', 'CeraVe', 'Cleansers')).toMatchObject({ outcome: 'HOLD', reason: 'POLICY_NOT_CONFIGURED' });
    expect(p.evaluateIdentity({ productId: 'x', brandId: 'b', categoryId: 'c' })).toMatchObject({ outcome: 'HOLD', reason: 'POLICY_NOT_CONFIGURED' });
  });
});
