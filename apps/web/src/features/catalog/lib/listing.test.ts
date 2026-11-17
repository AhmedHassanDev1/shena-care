import { routes } from '@/lib/routes';
import { departmentOf, listingContext, toQueryString, type CategoryNode } from './listing';

const tree: CategoryNode[] = [
  { id: 'r1', name: 'Skin Care', slug: 'skin-care', children: [{ id: 'c1', name: 'Cleansers', slug: 'cleansers' }] },
  { id: 'r2', name: 'Hair Care', slug: 'hair-care', children: [{ id: 'c2', name: 'Shampoos', slug: 'shampoos' }] },
];

describe('listingContext (PLPStates «سياق الصفحة»)', () => {
  it('shows the department banner only on a department’s first, unfiltered page', () => {
    expect(listingContext({ category: 'skin-care' }, tree)).toMatchObject({ kind: 'department', department: { slug: 'skin-care' } });
    expect(listingContext({ category: 'skin-care', brand: 'eva' }, tree)).toMatchObject({ kind: 'filtered', department: { slug: 'skin-care' } });
  });

  it('keeps a chosen subcategory on the department page (same page, selector stays) and carries the child', () => {
    expect(listingContext({ category: 'skin-care' }, tree)).toMatchObject({ kind: 'department', child: null });
    expect(listingContext({ category: 'cleansers' }, tree)).toMatchObject({
      kind: 'department',
      department: { slug: 'skin-care' },
      child: { slug: 'cleansers' },
    });
    expect(listingContext({ category: 'cleansers', brand: 'eva' }, tree)).toMatchObject({ kind: 'filtered', department: { slug: 'skin-care' } });
    expect(listingContext({ category: 'unknown-slug' }, tree)).toMatchObject({ kind: 'filtered', department: null });
  });

  it('shows the Brand Line header for a product line, never mixing it with categories or concerns', () => {
    expect(listingContext({ productLine: 'l-oral-paris-hyaluron-moisture' }, tree)).toEqual({
      kind: 'line',
      line: 'l-oral-paris-hyaluron-moisture',
      brand: undefined,
    });
    expect(listingContext({ productLine: 'x', brand: 'loral-paris' }, tree)).toMatchObject({ kind: 'line', brand: 'loral-paris' });
    expect(listingContext({ productLine: 'x', category: 'cleansers' }, tree)).toMatchObject({ kind: 'filtered' });
    expect(listingContext({ productLine: 'x', concern: 'acne' }, tree)).toMatchObject({ kind: 'concern' });
    expect(listingContext({ productLine: 'x', q: 'serum' }, tree)).toMatchObject({ kind: 'search' });
  });

  it('prefers search, then concern, then brand, then all', () => {
    expect(listingContext({ q: 'vitamin', category: 'skin-care' }, tree)).toEqual({ kind: 'search', q: 'vitamin' });
    expect(listingContext({ concern: 'acne' }, tree)).toEqual({ kind: 'concern', concern: 'acne', department: null });
    expect(listingContext({ brand: 'eva-cosmetics' }, tree)).toEqual({ kind: 'brand', brand: 'eva-cosmetics' });
    expect(listingContext({}, tree)).toEqual({ kind: 'all' });
  });
});

describe('departmentOf / toQueryString', () => {
  it('resolves a child category to its root department', () => {
    expect(departmentOf('shampoos', tree)?.slug).toBe('hair-care');
    expect(departmentOf('unknown', tree)).toBeNull();
    expect(departmentOf(undefined, tree)).toBeNull();
  });

  it('serialises only set filters and maps skinType to skin', () => {
    expect(toQueryString({ category: 'skin-care', brand: undefined })).toBe('?category=skin-care');
    expect(toQueryString({ concern: 'acne', skinType: 'oily', sort: 'price-asc' })).toBe('?concern=acne&skin=oily&sort=price-asc');
    expect(toQueryString({})).toBe('');
  });
});

describe('Brand Line and category routes', () => {
  it('builds URLs the existing discovery filters already understand', () => {
    expect(routes.productsByLine('l-oral-paris-hyaluron-moisture')).toBe('/products?productLine=l-oral-paris-hyaluron-moisture');
    expect(routes.productsByBrand('loral-paris')).toBe('/products?brand=loral-paris');
    expect(toQueryString({ productLine: 'x', brand: 'y' })).toBe('?productLine=x&brand=y');
  });
});
