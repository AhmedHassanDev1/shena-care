import { normalizeSearchText } from '../../src/modules/catalog/search/search-text';
import { DiscoveryService } from '../../src/application/composition/services/discovery.service';

describe('product search', () => {
  it.each([
    ['  إِسْتِخدام آمن  ', 'استخدام امن'],
    ['كريم للْبشرة', 'كريم للبشره'],
    ['CeraVe  SERUM', 'cerave serum'],
  ])('normalizes Arabic and English search text', (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected);
  });

  it('preserves provider ranking after sellability checks and paginates it', async () => {
    const ranked = '00000000-0000-0000-0000-000000000001';
    const hidden = '00000000-0000-0000-0000-000000000002';
    const second = '00000000-0000-0000-0000-000000000003';
    const product = (id: string) => ({ id, name: 'Serum', concerns: [], brand: { slug: 'brand', name: 'Brand' } });
    const catalog = { getPublishedProductsByIds: jest.fn(async (ids: string[]) => ids.map(product)) };
    const views = { composeProduct: jest.fn(async (p: { id: string; name: string; brand: { name: string; slug: string } }) =>
      p.id === hidden ? null : { ...p, skus: [] }) };
    const provider = { search: jest.fn(async () => [ranked, hidden, second]), suggest: jest.fn() };
    const care = { getPublicConcerns: jest.fn(async () => []) };
    const service = new DiscoveryService(catalog as never, views as never, provider as never, care as never);
    const first = await service.discover({ q: 'serum', limit: 1 });
    expect(first.items.map(p => p.id)).toEqual([ranked]);
    expect(first.total).toBe(2);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const next = await service.discover({ q: 'serum', limit: 1, cursor: first.pageInfo.nextCursor! });
    expect(next.items.map(p => p.id)).toEqual([second]);
  });
});
