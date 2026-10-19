import { departmentOf, listingContext, toQueryString, type CategoryNode } from './listing';

const tree: CategoryNode[] = [
  { id: 'r1', name: 'Skin Care', slug: 'skin-care', children: [{ id: 'c1', name: 'Cleansers', slug: 'cleansers' }] },
  { id: 'r2', name: 'Hair Care', slug: 'hair-care', children: [{ id: 'c2', name: 'Shampoos', slug: 'shampoos' }] },
];

describe('listingContext (PLPStates «سياق الصفحة»)', () => {
  it('shows the department banner only on a department’s first, unfiltered page', () => {
    expect(listingContext({ category: 'skin-care' }, tree)).toMatchObject({ kind: 'department', department: { slug: 'skin-care' } });
    expect(listingContext({ category: 'skin-care', brand: 'eva' }, tree)).toMatchObject({ kind: 'filtered', department: { slug: 'skin-care' } });
    expect(listingContext({ category: 'cleansers' }, tree)).toMatchObject({ kind: 'filtered', department: { slug: 'skin-care' } });
  });

  it('prefers search, then brand, then all', () => {
    expect(listingContext({ q: 'vitamin', category: 'skin-care' }, tree)).toEqual({ kind: 'search', q: 'vitamin' });
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

  it('serialises only set filters', () => {
    expect(toQueryString({ category: 'skin-care', brand: undefined })).toBe('?category=skin-care');
    expect(toQueryString({})).toBe('');
  });
});
