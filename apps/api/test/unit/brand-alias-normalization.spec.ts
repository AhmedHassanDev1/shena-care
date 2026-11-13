import { BRAND_ALIASES, curatedBrandAlias, normalizeBrandKey } from '../../src/modules/catalog/research/brand-aliases';

describe('reviewed brand aliases keep Arabic and English identity', () => {
  it.each([['سِيـرَافِي', 'CeraVe'], ['Cera Ve', 'CeraVe'], ['La Roche–Posay', 'La Roche-Posay'], ['ذا أورديناري', 'The Ordinary'], ['فيشى', 'Vichy']])('resolves formatting of an existing reviewed spelling %s', (input, brand) => {
    expect(curatedBrandAlias(input)?.canonicalName).toBe(brand);
  });
  it('does not erase letters or collide unrelated brand keys', () => {
    expect(normalizeBrandKey('CeraVe')).toBe('cerave');
    expect(normalizeBrandKey('بيوديرما')).toBe('بيوديرما');
    expect(normalizeBrandKey('CeraVe')).not.toBe(normalizeBrandKey('Bioderma'));
  });
  it('does not invent aliases or repair ambiguous short brand typos', () => {
    for (const name of ['unknown brand', 'Vichi', 'EvaX', 'CeraVe Bioderma']) expect(curatedBrandAlias(name)).toBeNull();
  });
  it('retains every existing dictionary entry and never merges different canonical brands', () => {
    const keys = new Map<string, string>();
    for (const [alias, brand] of Object.entries(BRAND_ALIASES)) {
      expect(curatedBrandAlias(alias)?.slug).toBe(brand.slug);
      const key = normalizeBrandKey(alias);
      if (keys.has(key)) expect(keys.get(key)).toBe(brand.slug);
      keys.set(key, brand.slug);
    }
  });
});
