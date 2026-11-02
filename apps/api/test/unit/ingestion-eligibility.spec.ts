import { compileEligibilityPolicy } from '../../src/modules/ingestion/services/ingestion-eligibility.policy';

describe('versioned ingestion eligibility', () => {
  const document = {
    brands: [{ id: 'b', name: 'CeraVe', isActive: true, effect: 'ALLOW' as const, aliases: ['سيرافي'] },
      { id: 'x', name: 'Excluded', isActive: true, effect: 'DENY' as const, aliases: [] }],
    categories: [{ id: 'root', name: 'Skin', parentId: null, isActive: true, effect: null },
      { id: 'leaf', name: 'Cleansers', parentId: 'root', isActive: true, effect: 'ALLOW' as const }],
    mappings: [{ supplierId: 's', label: 'غسول', categoryIds: ['leaf'] }],
  };
  const resolve = (brand: string, category: string, doc = document) =>
    compileEligibilityPolicy({ id: 'p', version: 3, document: doc }).evaluate('s', brand, category);
  it('requires both reviewed brand and category', () => {
    expect(resolve('CeraVe', 'غسول')).toMatchObject({ outcome: 'ALLOW', brandId: 'b', categoryId: 'leaf', version: 3 });
    expect(resolve('Excluded', 'غسول').outcome).toBe('SKIP');
    expect(resolve('CeraVe', 'unmapped').outcome).toBe('HOLD');
  });
  it('normalizes Arabic without fuzzy approval', () => {
    expect(resolve('سِيرافي', 'غسول').outcome).toBe('ALLOW');
    expect(resolve('Ceravee', 'غسول').outcome).toBe('HOLD');
  });
  it('holds parent categories and collisions', () => {
    expect(resolve('CeraVe', 'Skin').outcome).toBe('HOLD');
    expect(resolve('CeraVe', 'غسول', { ...document, mappings: [{ supplierId: 's', label: 'غسول', categoryIds: ['leaf', 'root'] }] }).outcome).toBe('HOLD');
    expect(resolve('CeraVe', 'غسول', { ...document, brands: [...document.brands, { ...document.brands[0], id: 'collision' }] }).outcome).toBe('HOLD');
  });
  it('ancestor DENY overrides a leaf ALLOW', () => {
    const doc = { ...document, categories: document.categories.map(c => c.id === 'root' ? { ...c, effect: 'DENY' as const } : c) };
    expect(resolve('CeraVe', 'غسول', doc).outcome).toBe('SKIP');
  });
  it('holds when no approved policy exists', () => {
    expect(compileEligibilityPolicy(null).evaluate('s', 'CeraVe', 'Cleansers')).toMatchObject({ outcome: 'HOLD', reason: 'POLICY_NOT_CONFIGURED' });
  });
  it('requires category approval even for an allowed brand, and never inherits parent ALLOW', () => {
    const withoutLeaf = { ...document, categories: document.categories.map(c => ({ ...c, effect: c.id === 'root' ? 'ALLOW' as const : null })) };
    expect(resolve('CeraVe', 'غسول', withoutLeaf).outcome).toBe('SKIP');
    expect(resolve('Missing brand', 'غسول').outcome).toBe('HOLD');
  });
  it('evaluates 50,000 exclusions using one compiled snapshot', () => {
    const policy = compileEligibilityPolicy({ id: 'p', version: 3, document });
    const started = performance.now();
    let skipped = 0;
    for (let row = 0; row < 50_000; row++) if (policy.evaluate('s', 'Excluded', 'غسول').outcome === 'SKIP') skipped++;
    expect(skipped).toBe(50_000);
    console.info(`Eligibility evaluator only: ${skipped} decisions in ${(performance.now() - started).toFixed(1)} ms; no parser, DB or network`);
  });
});
