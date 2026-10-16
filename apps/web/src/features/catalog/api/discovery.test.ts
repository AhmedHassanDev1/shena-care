import { sanitizeFilters } from './discovery';

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
