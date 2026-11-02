import { compileEligibilityPolicy, EligibilityDocument } from '../../src/modules/ingestion/services/ingestion-eligibility.policy';

describe('Egyptian supplier label resolution — reviewed evidence, never fuzzy admission', () => {
  const document: EligibilityDocument & { resolutionVersion: number } = {
    resolutionVersion: 2,
    brands: [
      { id: 'cerave', name: 'CeraVe', effect: 'ALLOW', isActive: true, aliases: ['سيرافي', 'سرافي'] },
      { id: 'bioderma', name: 'Bioderma', effect: 'ALLOW', isActive: true, aliases: ['بيوديرما'] },
      { id: 'excluded', name: 'Excluded', effect: 'DENY', isActive: true, aliases: ['مستبعد'] },
    ],
    categories: [
      { id: 'skin', name: 'Skin Care', parentId: null, effect: null, isActive: true },
      { id: 'cleanser', name: 'Facial Cleansers', parentId: 'skin', effect: 'ALLOW', isActive: true, aliases: ['غسول الوجه'] },
      { id: 'excluded-category', name: 'Perfumes', parentId: null, effect: 'DENY', isActive: true },
    ],
    mappings: [{ supplierId: 'a', label: 'غسول بشرة', categoryIds: ['cleanser'] },
      { supplierId: 'b', label: 'Face Wash', categoryIds: ['cleanser'] }],
  };
  const compile = (doc = document) => compileEligibilityPolicy({ id: 'policy', version: 2, document: doc });

  it.each(['CeraVe', 'سيرافي', 'سرافي', '  سِـيرافى  ', 'Cera-Ve', 'C E R A V E', 'سي رافي', 'ماركة سيرافي أصلي', 'منتجات CeraVe - مستورد', 'كريم سيرافي مرطب', 'سيرافي غسول ٢٣٦ مل'])
  ('admits reviewed brand evidence and formatting: %s', brand => {
    expect(compile().evaluate('a', brand, 'غسول-بشرة')).toMatchObject({ outcome: 'ALLOW', brandId: 'cerave', categoryId: 'cleanser' });
  });
  it.each(['Ceravee', 'شبيه سيرافي', 'بديل سيرافي', 'Unknown CeraVe', 'CeraVe Bioderma', 'CeraVe 2', 'سيرافي بلس'])('holds uncertain or conflicting descriptions: %s', brand => {
    expect(compile().evaluate('a', brand, 'غسول بشرة').outcome).toBe('HOLD');
  });
  it('retrieves typo candidates without admitting the typo', () => {
    const policy = compile();
    expect(policy.suggestBrands('Ceravee')[0]).toMatchObject({ brandId: 'cerave' });
    expect(policy.evaluate('a', 'Ceravee', 'غسول بشرة')).toMatchObject({ outcome: 'HOLD', reason: 'BRAND_UNKNOWN' });
  });
  it('requires the informal Arabic variant to have been explicitly reviewed', () => {
    const policy = compile({ ...document, brands: document.brands.map(b => b.id === 'cerave' ? { ...b, aliases: ['سيرافي'] } : b) });
    expect(policy.evaluate('a', 'سرافي', 'غسول بشرة').outcome).toBe('HOLD');
    expect(policy.suggestBrands('سرافي')[0]).toMatchObject({ brandId: 'cerave' });
  });
  it('shares approved brand aliases globally and reuses supplier-specific category names', () => {
    const policy = compile();
    expect(policy.evaluate('a', 'سرافي', 'غسول بشرة').outcome).toBe('ALLOW');
    expect(policy.evaluate('a', 'سيرافي', 'غسول-بشره').outcome).toBe('ALLOW');
    expect(policy.evaluate('b', 'Cera-Ve', 'Face-Wash').outcome).toBe('ALLOW');
    expect(policy.evaluate('other', 'سيرافي', 'غسول الوجه').outcome).toBe('ALLOW');
    expect(policy.evaluate('other', 'CeraVe', 'Face Wash').outcome).toBe('HOLD');
  });
  it('does not guess missing/ambiguous categories and skips known excluded categories', () => {
    const policy = compile({ ...document, mappings: [...document.mappings,
      { supplierId: 'a', label: 'عناية', categoryIds: ['cleanser', 'excluded-category'] }] });
    expect(policy.evaluate('a', 'CeraVe', '').outcome).toBe('HOLD');
    expect(policy.evaluate('a', 'CeraVe', 'عناية').outcome).toBe('HOLD');
    expect(policy.evaluate('a', 'CeraVe', 'Perfumes').outcome).toBe('SKIP');
  });
  it('holds normalized alias collisions rather than choosing a brand', () => {
    const policy = compile({ ...document, brands: [...document.brands,
      { id: 'collision', name: 'Other', effect: 'ALLOW', isActive: true, aliases: ['Cera Ve'] }] });
    expect(policy.evaluate('a', 'CeraVe', 'غسول بشرة').outcome).toBe('HOLD');
  });
  it('preserves legacy snapshot decisions and memoizes repeated labels in a compiled job', () => {
    const legacy = compileEligibilityPolicy({ id: 'old', version: 1, document: { ...document, resolutionVersion: undefined } });
    expect(legacy.evaluate('a', 'Cera-Ve', 'غسول بشرة').outcome).toBe('HOLD');
    const policy = compile();
    expect(policy.evaluate('a', 'سرافي', 'غسول بشرة')).toBe(policy.evaluate('a', 'سرافي', 'غسول بشرة'));
  });
});
