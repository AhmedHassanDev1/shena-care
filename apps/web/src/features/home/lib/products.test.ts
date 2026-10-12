import type { ProductView } from '@/features/catalog/api/products';
import { resolveQuickAdd, selectFeaturedProducts, toProductCardModel } from './products';

type Sku = ProductView['skus'][number];

const sku = (id: string, price: number | null, overrides: Partial<Sku> = {}): Sku => ({
  id,
  code: id.toUpperCase(),
  variantName: 'Default',
  size: 50,
  sizeUnit: 'ml',
  price: price === null ? null : { amount: price, currency: 'EGP', compareAtAmount: null },
  canOrder: true,
  ...overrides,
});

const product = (skus: Sku[], overrides: Partial<ProductView> = {}): ProductView => ({
  id: 'p1',
  name: 'Micellar water',
  slug: 'micellar-water',
  description: null,
  usage: null,
  warnings: null,
  brand: { id: 'b1', name: 'Bioderma', slug: 'bioderma' },
  skus,
  media: [{ id: 'm1', type: 'image', url: 'https://cdn.shopify.com/a.png', altText: null, isPrimary: true }],
  ...overrides,
});

describe('resolveQuickAdd', () => {
  it('adds directly when the product has exactly one orderable, priced SKU', () => {
    expect(resolveQuickAdd(product([sku('s1', 450)]))).toEqual({ kind: 'add', skuId: 's1' });
  });

  it('sends the shopper to the product page when there are several variants', () => {
    expect(resolveQuickAdd(product([sku('s1', 450), sku('s2', 600)]))).toEqual({ kind: 'choose' });
  });

  it('still asks for a choice when only one of several variants is orderable', () => {
    expect(resolveQuickAdd(product([sku('s1', 450), sku('s2', 600, { canOrder: false })]))).toEqual({ kind: 'choose' });
  });

  it('is unavailable when nothing can be ordered or no SKU has a price', () => {
    expect(resolveQuickAdd(product([sku('s1', 450, { canOrder: false })]))).toEqual({ kind: 'unavailable' });
    expect(resolveQuickAdd(product([sku('s1', null)]))).toEqual({ kind: 'unavailable' });
  });
});

describe('toProductCardModel', () => {
  it('uses the real catalog price, brand and pack size of a single-variant product', () => {
    const model = toProductCardModel(product([sku('s1', 450, { size: 500 })]));
    expect(model).toMatchObject({
      brandName: 'Bioderma',
      price: { amount: 450, currency: 'EGP' },
      priceIsFrom: false,
      size: 500,
      sizeUnit: 'ml',
    });
  });

  it('shows the lowest price as "from" when variants differ, and hides an ambiguous size', () => {
    const model = toProductCardModel(product([sku('s1', 540, { size: 236 }), sku('s2', 690, { size: 473 })]));
    expect(model.price?.amount).toBe(540);
    expect(model.priceIsFrom).toBe(true);
    expect(model.size).toBeNull();
  });

  it('does not mark equal-priced variants as "from"', () => {
    expect(toProductCardModel(product([sku('s1', 100), sku('s2', 100)])).priceIsFrom).toBe(false);
  });

  it('prefers the primary image and ignores video media', () => {
    const model = toProductCardModel(
      product([sku('s1', 450)], {
        media: [
          { id: 'v', type: 'video', url: 'https://x/v.mp4', altText: null, isPrimary: true },
          { id: 'i2', type: 'image', url: 'https://x/2.png', altText: 'second', isPrimary: false },
          { id: 'i1', type: 'image', url: 'https://x/1.png', altText: null, isPrimary: true },
        ],
      }),
    );
    expect(model.imageUrl).toBe('https://x/1.png');
    expect(model.imageAlt).toBe('Micellar water');
  });

  it('reports a missing image and a missing price without inventing either', () => {
    const model = toProductCardModel(product([sku('s1', null)], { media: [] }));
    expect(model.imageUrl).toBeNull();
    expect(model.price).toBeNull();
    expect(model.action).toEqual({ kind: 'unavailable' });
  });
});

describe('selectFeaturedProducts', () => {
  it('keeps API order and caps the count', () => {
    const products = ['a', 'b', 'c'].map((id) => product([sku(id, 10)], { id, slug: id }));
    expect(selectFeaturedProducts(products, 2).map((p) => p.id)).toEqual(['a', 'b']);
  });
});
