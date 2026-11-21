import {
  buildSearchOptions,
  matchActiveBrands,
  normalizeSearchQuery,
  nextScrollTopForOptionVisibility,
  stepActiveIndex,
  rememberSearch,
  readRecentSearches,
} from './search-helpers';

describe('search-helpers', () => {
  it('stores only distinct bounded submitted searches and ignores corrupt history', () => {
    expect(rememberSearch(['غسول', 'serum'], ' غسول ')).toEqual(['غسول', 'serum']);
    expect(rememberSearch(['one', 'two', 'three', 'four', 'five'], 'six')).toEqual(['six', 'one', 'two', 'three', 'four']);
    expect(rememberSearch([], 'x')).toEqual([]);
    expect(readRecentSearches('{broken')).toEqual([]);
    expect(readRecentSearches('["غسول",12,null,"serum"]')).toEqual(['غسول', 'serum']);
  });
  it('normalizes whitespace and caps queries at 120 chars', () => {
    expect(normalizeSearchQuery('   غسول    بشرة  ')).toBe('غسول بشرة');
    expect(normalizeSearchQuery('a'.repeat(150)).length).toBe(120);
  });

  it('matches active brands across Arabic, English, and slug forms with prefix priority', () => {
    const brands = [
      { slug: 'the-hair-addict', name: 'ذا هير أديكت', isActive: true },
      { slug: 'eva-cosmetics', name: 'إيفا كوزمتكس', isActive: true },
      { slug: 'cerave', name: 'سيرافي', isActive: true },
      { slug: 'hidden-brand', name: 'CeraVe Hidden', isActive: false },
    ];

    expect(matchActiveBrands(brands, 'cera').map((b) => b.slug)).toEqual(['cerave']);
    expect(matchActiveBrands(brands, 'ايفا').map((b) => b.slug)).toEqual(['eva-cosmetics']);
    expect(matchActiveBrands(brands, 'hair addict').map((b) => b.slug)).toEqual(['the-hair-addict']);
    expect(matchActiveBrands(brands, 'س')).toEqual([]);
  });

  it('builds keyboard options matching section order and appends view-all only with results', () => {
    const options = buildSearchOptions({
      query: 'سيرافي',
      brands: [{ slug: 'cerave', name: 'سيرافي' }],
      products: [
        {
          id: 'p1',
          name: 'غسول مرطب',
          slug: 'cerave-hydrating-cleanser',
          brand: { name: 'سيرافي', slug: 'cerave' },
        },
      ],
      viewAllLabel: 'اعرض الكل',
    });

    expect(options).toEqual([
      {
        id: 'brand:cerave',
        kind: 'brand',
        href: '/products?brand=cerave',
        slug: 'cerave',
        label: 'سيرافي',
      },
      {
        id: 'product:p1',
        kind: 'product',
        href: '/products/cerave-hydrating-cleanser',
        slug: 'cerave-hydrating-cleanser',
        label: 'غسول مرطب',
        brandName: 'سيرافي',
      },
      {
        id: 'search:view-all',
        kind: 'view-all',
        href: '/products?q=%D8%B3%D9%8A%D8%B1%D8%A7%D9%81%D9%8A',
        label: 'اعرض الكل',
      },
    ]);

    expect(
      buildSearchOptions({
        query: 'سيرافي',
        brands: [],
        products: [],
        viewAllLabel: 'اعرض الكل',
      }),
    ).toEqual([]);
  });

  it('steps active option index with wrap-around and boundary keys', () => {
    expect(stepActiveIndex(-1, 0, 'ArrowDown')).toBe(-1);
    expect(stepActiveIndex(-1, 3, 'ArrowDown')).toBe(0);
    expect(stepActiveIndex(2, 3, 'ArrowDown')).toBe(0);
    expect(stepActiveIndex(-1, 3, 'ArrowUp')).toBe(2);
    expect(stepActiveIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(stepActiveIndex(1, 3, 'Home')).toBe(0);
    expect(stepActiveIndex(0, 3, 'End')).toBe(2);
  });

  it('keeps keyboard navigation scroll confined to the suggestion panel', () => {
    expect(nextScrollTopForOptionVisibility({
      scrollTop: 100,
      viewportTop: 200,
      viewportBottom: 500,
      optionTop: 140,
      optionBottom: 190,
    })).toBe(40);

    expect(nextScrollTopForOptionVisibility({
      scrollTop: 100,
      viewportTop: 200,
      viewportBottom: 500,
      optionTop: 480,
      optionBottom: 530,
    })).toBe(130);

    expect(nextScrollTopForOptionVisibility({
      scrollTop: 100,
      viewportTop: 200,
      viewportBottom: 500,
      optionTop: 260,
      optionBottom: 320,
    })).toBe(100);
  });
});
