import { facetDisplayName, sanitizeFilters, withoutFacet } from './discovery';

jest.mock('@/lib/api-client', () => ({ apiClient: { get: jest.fn() } }));

describe('sanitizeFilters', () => {
  it('keeps valid slugs and a trimmed search', () => {
    expect(sanitizeFilters({ q: '  سيروم  ', brand: 'nuv-lab', category: 'skin-care', productLine: 'bright-c', concern: 'acne' }))
      .toEqual({ q: 'سيروم', brand: 'nuv-lab', category: 'skin-care', productLine: 'bright-c', concern: 'acne' });
  });

  it('drops values the API would reject instead of sending a 400-bound request', () => {
    expect(sanitizeFilters({ brand: 'Nuvé Lab', category: '../x', productLine: 'a'.repeat(161), q: '   ' })).toEqual({});
  });

  it('caps the search length at the API maximum', () => {
    expect(sanitizeFilters({ q: 'x'.repeat(200) }).q).toHaveLength(120);
  });
});

describe('withoutFacet', () => {
  it('drops only the given facet and keeps search, other facets and concern', () => {
    const filters = { q: 'serum', brand: 'bless', category: 'cleansers', concern: 'acne' };
    expect(withoutFacet(filters, 'brand')).toEqual({ q: 'serum', category: 'cleansers', concern: 'acne' });
    expect(filters.brand).toBe('bless');
  });
});

describe('facetDisplayName', () => {
  const categories = [{ slug: 'cleansers', name: 'Cleansers', count: 5 }];

  it('uses the facet name when the API lists the value', () => {
    expect(facetDisplayName('cleansers', categories, { 'skin-care': 'Skin care' })).toBe('Cleansers');
  });

  it('names a root category the facets never list instead of showing its slug', () => {
    expect(facetDisplayName('skin-care', categories, { 'skin-care': 'Skin care' })).toBe('Skin care');
  });

  it('falls back to the slug when nothing names it', () => {
    expect(facetDisplayName('unknown', undefined)).toBe('unknown');
  });
});
