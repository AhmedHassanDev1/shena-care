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
    const views = { composeProducts: jest.fn(async (products: Array<{ id: string; name: string; brand: { name: string; slug: string } }>) =>
      products.map(p => p.id === hidden ? null : { ...p, skus: [] })) };
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

  it('keeps search results beyond the first ten ranked products', async () => {
    const ids = Array.from({ length: 12 }, (_, n) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`);
    const catalog = { getPublishedProductsByIds: jest.fn(async (batch: string[]) => batch.map(id =>
      ({ id, name: 'Serum', concerns: [], brand: { name: 'Brand', slug: 'brand' } }))) };
    const views = { composeProducts: jest.fn(async (batch: Array<{ id: string; name: string; brand: { name: string; slug: string } }>) =>
      batch.map(p => ({ ...p, skus: [] }))) };
    const provider = { search: jest.fn(async () => ids) };
    const service = new DiscoveryService(catalog as never, views as never, provider as never,
      { getPublicConcerns: jest.fn(async () => []) } as never);

    const result = await service.discover({ q: 'serum', limit: 20 });

    expect(result.total).toBe(12);
    expect(result.items.map(p => p.id)).toEqual(ids);
  });

  it('stops composing suggestion candidates once the requested suggestions are found', async () => {
    const ids = Array.from({ length: 20 }, (_, n) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`);
    const catalog = { getPublishedProductsByIds: jest.fn(async (batch: string[]) => batch.map(id =>
      ({ id, name: 'Serum', concerns: [], brand: { name: 'Brand', slug: 'brand' } }))) };
    const views = { composeProducts: jest.fn(async (batch: Array<{ id: string; name: string; brand: { name: string; slug: string } }>) =>
      batch.map(p => ({ ...p, slug: p.id, skus: [] }))) };
    const provider = { suggest: jest.fn(async () => ids) };
    const service = new DiscoveryService(catalog as never, views as never, provider as never,
      { getPublicConcerns: jest.fn(async () => []) } as never);

    const result = await service.suggest({ q: 'serum', limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(views.composeProducts.mock.calls[0][0]).toHaveLength(10);
  });
});
