import { getHeaderNavItems, isHeaderNavActive } from './header-nav';

describe('header-nav', () => {
  const labels = {
    navSkin: 'البشرة',
    navHair: 'الشعر',
    navBrands: 'الماركات',
  };

  it('exposes only Skin, Hair, and Brands in display order', () => {
    expect(getHeaderNavItems(labels)).toEqual([
      { key: 'skin', href: '/products?category=skin-care', label: 'البشرة' },
      { key: 'hair', href: '/products?category=hair-care', label: 'الشعر' },
      { key: 'brands', href: '/products', label: 'الماركات' },
    ]);
  });

  it('activates Skin on skin-care category or resolved child department', () => {
    expect(isHeaderNavActive('skin', { pathname: '/products', categoryParam: 'skin-care' })).toBe(true);
    expect(isHeaderNavActive('brands', { pathname: '/products', categoryParam: 'skin-care' })).toBe(false);
    expect(
      isHeaderNavActive('skin', {
        pathname: '/products',
        categoryParam: 'cleansers',
        departmentSlug: 'skin-care',
      }),
    ).toBe(true);
  });

  it('activates Hair on hair-care category and not Skin or Brands', () => {
    expect(isHeaderNavActive('hair', { pathname: '/products', categoryParam: 'hair-care' })).toBe(true);
    expect(isHeaderNavActive('skin', { pathname: '/products', categoryParam: 'hair-care' })).toBe(false);
    expect(isHeaderNavActive('brands', { pathname: '/products', categoryParam: 'hair-care' })).toBe(false);
  });

  it('activates Brands on `/products` and `/products?brand=...`, never during generic search', () => {
    expect(isHeaderNavActive('brands', { pathname: '/products' })).toBe(true);
    expect(isHeaderNavActive('brands', { pathname: '/products/', brandParam: 'cerave' })).toBe(true);
    expect(isHeaderNavActive('brands', { pathname: '/products', searchQuery: 'غسول' })).toBe(false);
    expect(
      isHeaderNavActive('brands', {
        pathname: '/products',
        searchQuery: 'غسول',
        brandParam: 'cerave',
      }),
    ).toBe(true);
  });

  it('returns false across all items outside `/products`', () => {
    for (const pathname of ['/', '/routines', '/shina', '/products/cerave-cleanser', '/cart', '/orders']) {
      expect(isHeaderNavActive('skin', { pathname })).toBe(false);
      expect(isHeaderNavActive('hair', { pathname })).toBe(false);
      expect(isHeaderNavActive('brands', { pathname })).toBe(false);
    }
  });
});
