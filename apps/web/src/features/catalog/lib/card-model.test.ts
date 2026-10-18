import type { ProductView } from '../api/products';
import { categoryLabel, toCardModel } from './card-model';

const sku = (over: Partial<ProductView['skus'][number]> = {}): ProductView['skus'][number] => ({
  id: 'sku-1',
  code: 'C-1',
  variantName: 'Default',
  size: 30,
  sizeUnit: 'ml',
  price: { amount: 750, currency: 'EGP', compareAtAmount: null },
  canOrder: true,
  ...over,
});

const product = (skus: ProductView['skus'], over: Partial<ProductView> = {}): ProductView => ({
  id: 'p-1',
  name: 'Niacinamide 10% + Zinc 1%',
  slug: 'niacinamide',
  description: null,
  usage: null,
  warnings: null,
  brand: { id: 'b-1', name: 'The Ordinary', slug: 'the-ordinary' },
  category: { id: 'c-1', name: 'Serums & Treatments', slug: 'serums-treatments', parentId: 'root' },
  skus,
  media: [{ id: 'm-1', type: 'image', url: 'https://res.cloudinary.com/x.jpg', altText: null, isPrimary: true }],
  ...over,
});

describe('toCardModel', () => {
  it('joins same-unit sizes as «٣٠ أو ٦٠ مل» and reads «من» when variant prices differ', () => {
    const card = toCardModel(
      product([sku(), sku({ id: 'sku-2', size: 60, price: { amount: 1150, currency: 'EGP', compareAtAmount: null } })]),
      'ar',
    );
    expect(card.sizeLine).toBe('٣٠ أو ٦٠ مل');
    expect(card.price).toEqual({ amount: 750, currency: 'EGP' });
    expect(card.priceIsFrom).toBe(true);
    expect(card.variants).toHaveLength(2);
    expect(card.type).toBe('سيرم وعلاج');
  });

  it('marks a product with no orderable priced SKU as unavailable, with no price', () => {
    const card = toCardModel(product([sku({ canOrder: false }), sku({ id: 'sku-2', price: null })]), 'ar');
    expect(card.unavailable).toBe(true);
    expect(card.price).toBeNull();
    expect(card.variants).toEqual([]);
  });

  it('keeps Western digits and the catalog category name in English', () => {
    const card = toCardModel(product([sku()]), 'en', ' or ');
    expect(card.sizeLine).toBe('30 ml');
    expect(card.type).toBe('Serums & Treatments');
  });
});

describe('categoryLabel', () => {
  it('falls back to the catalog name for categories it does not translate', () => {
    expect(categoryLabel({ slug: 'new-category', name: 'New Category' }, 'ar')).toBe('New Category');
    expect(categoryLabel(null, 'ar')).toBeNull();
  });
});
