import { normalizeSearchText } from '../../src/modules/catalog/search/search-text';
import { DiscoveryService } from '../../src/application/composition/services/discovery.service';

describe('product search', () => {
  it('finds eligible suggestions beyond a page of hidden candidates', async () => {
    const ids = Array.from({ length: 101 }, (_, n) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`);
    const product = (id: string) => ({ id, name: 'Cleanser', slug: id, brand: { name: 'Brand', slug: 'brand' }, skus: [] });
    const service = new DiscoveryService({ getPublishedProductsByIds: async (batch: string[]) => batch.map(product) } as never,
      { composeProducts: async (batch: Array<{ id: string }>) => batch.map(p => p.id === ids[100] ? product(p.id) : null) } as never,
      { suggest: async (_filters: unknown, limit: number, offset = 0) => ids.slice(offset, offset + limit), search: async () => ids } as never,
      { getPublicConcerns: async () => [] } as never);
    expect((await service.suggest({ q: 'cleanser', limit: 1 })).items.map(item => item.id)).toEqual([ids[100]]);
  });
  it('sorts visible prices with stable pagination and binds the cursor to the selected sort', async () => {
    const ids = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'];
    const products = ids.map(id => ({ id, name: 'Serum', concerns: [], brand: { name: 'Brand', slug: 'brand' } }));
    const service = new DiscoveryService({ getPublishedProductsByIds: async () => products } as never,
      { composeProducts: async () => products.map((p, index) => ({ ...p, skus: [{ id: p.id, price: { amount: index ? 50 : 100, currency: 'EGP' } }] })) } as never,
      { search: async () => ids } as never, { getPublicConcerns: async () => [] } as never);
    const first = await service.discover({ q: 'serum', sort: 'price-asc', limit: 1 } as never);
    expect(first.items.map(p => p.id)).toEqual([ids[1]]);
    const next = await service.discover({ q: 'serum', sort: 'price-asc', limit: 1, cursor: first.pageInfo.nextCursor! } as never);
    expect(next.items.map(p => p.id)).toEqual([ids[0]]);
    await expect(service.discover({ q: 'serum', sort: 'price-desc', cursor: first.pageInfo.nextCursor! } as never)).rejects.toThrow('Invalid discovery cursor');
  });
  it('does not compare numeric prices in different currencies', async () => {
    const products = ['a', 'b'].map(id => ({ id, name: 'Serum', concerns: [], brand: { name: 'Brand', slug: 'brand' } }));
    const service = new DiscoveryService({ getPublishedProductsByIds: async () => products } as never,
      { composeProducts: async () => products.map((p, index) => ({ ...p, skus: [{ id: p.id, price: { amount: 50, currency: index ? 'SAR' : 'EGP' } }] })) } as never,
      { search: async () => ['a', 'b'] } as never, { getPublicConcerns: async () => [] } as never);
    await expect(service.discover({ q: 'serum', sort: 'price-asc' })).rejects.toThrow('different currencies');
  });
  it('retains a reviewed Arabic alias result after composition and rechecks only visible variants', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const product = { id, name: 'Hydrating Cleanser', concerns: [], brand: { name: 'CeraVe', slug: 'cerave' } };
    const provider = { search: jest.fn(async () => [id]) };
    const service = new DiscoveryService({ getPublishedProductsByIds: async () => [product] } as never,
      { composeProducts: async () => [{ ...product, skus: [{ id: 'visible-sku' }] }] } as never, provider as never,
      { getPublicConcerns: async () => [] } as never);
    expect((await service.discover({ q: 'سيرافي غسول' })).items.map(p => p.id)).toEqual([id]);
    expect(provider.search).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: { productIds: [id], skuIds: ['visible-sku'] } }));
  });
  it('removes a match supported only by a hidden SKU after the owner gates run', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const product = { id, name: 'Cleanser', concerns: [], brand: { name: 'Brand', slug: 'brand' } };
    const provider = { search: jest.fn(async (filters: { visibility?: unknown }) => filters.visibility ? [] : [id]) };
    const service = new DiscoveryService({ getPublishedProductsByIds: async () => [product] } as never,
      { composeProducts: async () => [{ ...product, skus: [{ id: 'visible-sku', code: 'OTHER' }] }] } as never, provider as never,
      { getPublicConcerns: async () => [] } as never);
    expect((await service.discover({ q: 'HIDDEN-SKU' })).items).toEqual([]);
  });
  it.each([
    ['  إِسْتِخدام آمن  ', 'استخدام امن'],
    ['كريم للْبشرة', 'كريم للبشره'],
    ['CeraVe  SERUM', 'cerave serum'],
    ['ＣｅｒａＶｅ ٢٣٦ ۲۳۶', 'cerave 236 236'],
    ['سيروم\u200d للشعر', 'سيروم للشعر'],
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
    const provider = { suggest: jest.fn(async () => ids), search: jest.fn(async () => ids) };
    const service = new DiscoveryService(catalog as never, views as never, provider as never,
      { getPublicConcerns: jest.fn(async () => []) } as never);

    const result = await service.suggest({ q: 'serum', limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(views.composeProducts.mock.calls[0][0]).toHaveLength(10);
  });

  it('passes concern and skinType filters to the search provider and discovers matching products', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const product = { id, name: 'Acne Cleanser', concerns: ['acne'], brand: { name: 'Brand', slug: 'brand' } };
    const provider = { search: jest.fn(async () => [id]) };
    const service = new DiscoveryService(
      { getPublishedProductsByIds: async () => [product] } as never,
      { composeProducts: async () => [{ ...product, skus: [{ id: 'sku-1' }] }] } as never,
      provider as never,
      { getPublicConcerns: async () => [{ slug: 'acne', name: 'Acne' }] } as never,
    );
    const result = await service.discover({ concern: 'acne', skinType: 'oily' } as never);
    expect(result.items.map(p => p.id)).toEqual([id]);
    expect(provider.search).toHaveBeenCalledWith(expect.objectContaining({
      concern: 'acne',
      skinType: 'oily',
    }));
  });
});
