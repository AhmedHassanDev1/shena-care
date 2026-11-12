import type { ProductDetail } from '@/features/catalog/api/discovery';
import type { ProductView } from '@/features/catalog/api/products';
import {
  buildShinaComparison,
  chooseCatalogProducts,
  classifyShinaIntent,
  pickComparisonPair,
  productViewToShinaProduct,
  routineSequenceToPreview,
  toChatProduct,
} from './catalog-chat';

const product = (name: string, slug: string, canOrder = true): ProductView => ({
  id: slug,
  name,
  slug,
  description: null,
  usage: null,
  warnings: null,
  brand: { id: 'brand', name: 'Real Brand', slug: 'real-brand' },
  category: {
    id: 'category',
    name: name.includes('Shampoo') ? 'Shampoo' : 'Cleansers',
    slug: name.includes('Shampoo') ? 'shampoo' : 'cleansers',
    parentId: null,
  },
  skus: [
    {
      id: `${slug}-sku`,
      code: 'SKU',
      variantName: '200 ml',
      size: 200,
      sizeUnit: 'ml',
      price: { amount: 105, currency: 'EGP', compareAtAmount: null },
      canOrder,
    },
  ],
  media: [
    {
      id: 'image',
      ...({ skuId: `${slug}-sku` } as any),
      type: 'image',
      url: 'https://manufacturer.example/real.jpg',
      altText: null,
      isPrimary: true,
    },
  ],
});

const detail = (overrides: Partial<ProductDetail>): ProductDetail => ({
  id: 'p1',
  name: 'Antioxidant Facial Cleanser',
  slug: 'antioxidant-cleanser',
  description: null,
  usage: 'Apply gently twice daily',
  warnings: 'Avoid eyes',
  brand: { id: 'b1', name: 'StarVille', slug: 'starville' },
  productLine: null,
  category: { id: 'c1', name: 'Cleansers', slug: 'cleansers', parentId: null },
  skus: [],
  media: [
    {
      id: 'm1',
      skuId: 'sku-1',
      type: 'image',
      url: 'https://cdn.example/p1.jpg',
      altText: null,
      sortOrder: 0,
      isPrimary: true,
      originType: 'catalog',
      role: null,
    },
  ],
  selectedSkuId: 'sku-1',
  selectedVariant: {
    id: 'sku-1',
    code: 'SV-1',
    barcode: null,
    variantName: '200 ml',
    size: 200,
    sizeUnit: 'ml',
    price: { amount: 185, currency: 'EGP', compareAtAmount: null },
    isAvailable: true,
    canOrder: true,
    availability: {
      isAvailable: true,
      isFresh: true,
      confirmedAt: null,
      observedAt: null,
      validUntil: null,
    },
    media: [],
    content: null,
    promotions: null,
  },
  evaluatedAt: '2026-11-11T00:00:00Z',
  ...overrides,
});

describe('catalog grounded chat cards', () => {
  it('matches an Arabic cleanser request to live catalog products', () => {
    const cleanser = product('Facial Cleanser', 'real-cleanser');
    const shampoo = product('Hyaluron Shampoo', 'real-shampoo');
    expect(chooseCatalogProducts('أفضل غسول', [cleanser, shampoo])).toEqual([cleanser]);
    expect(toChatProduct(cleanser)).toMatchObject({
      slug: 'real-cleanser',
      skuId: 'real-cleanser-sku',
      price: 105,
      imageUrl: 'https://manufacturer.example/real.jpg',
    });
  });

  it('never offers a SKU that the public API says cannot be ordered', () => {
    expect(toChatProduct(product('Facial Cleanser', 'unavailable', false))).toBeNull();
    expect(productViewToShinaProduct(product('Facial Cleanser', 'unavailable', false))).toMatchObject({
      canOrder: false,
      slug: 'unavailable',
    });
  });

  it('prefers a named catalog product over a broad cleanser category match', () => {
    const other = product('Antioxidant Facial Cleanser', 'other-cleanser');
    const named = product('StarVille Acne Prone Skin Facial Cleanser', 'starville-cleanser');
    expect(
      chooseCatalogProducts('طريقة استخدام StarVille Acne Prone Skin Facial Cleanser', [other, named]),
    ).toEqual([named]);
  });

  it('classifies compare, routine, search, and general consultation intents accurately', () => {
    expect(classifyShinaIntent('قارني بين غسولين للبشرة')).toBe('compare');
    expect(classifyShinaIntent('رتّبي لي روتين صباحي')).toBe('routine');
    expect(classifyShinaIntent('أفضل غسول متاح الآن')).toBe('search');
    expect(classifyShinaIntent('منتج xyz غير موجود إطلاقا')).toBe('search');
    expect(classifyShinaIntent('ما الفرق بين هذا وذاك vs')).toBe('compare');
    expect(classifyShinaIntent('بشرتي حساسة وتتهيج بسرعة فما نصيحتك؟')).toBe('chat');
  });

  it('picks two same-category products cleanly for comparison without inventing products', () => {
    const c1 = product('Antioxidant Cleanser', 'c1');
    const c2 = product('Acne Cleanser', 'c2');
    const sh = product('Moisture Shampoo', 's1');
    expect(pickComparisonPair('قارني بين غسولين', [sh, c1, c2])).toEqual([c1, c2]);
    expect(pickComparisonPair('قارني', [c1])).toBeNull();
  });

  it('builds a strictly factual comparison from ProductDetail specs', () => {
    const d1 = detail({
      slug: 'c1',
      name: 'Cleanser A',
      texture: 'GEL',
      isFragranceFree: true,
      suitableSkinTypes: ['oily', 'combination'],
    });
    const d2 = detail({
      id: 'p2',
      slug: 'c2',
      name: 'Sunscreen B',
      spf: 50,
      isNonComedogenic: true,
      selectedSkuId: 'sku-2',
      selectedVariant: {
        ...detail({}).selectedVariant,
        id: 'sku-2',
        canOrder: false,
        price: null,
      },
    });

    const cmp = buildShinaComparison([d1, d2], 'ar');
    expect(cmp.products[0].specs).toEqual(
      expect.arrayContaining([
        { label: 'القوام', value: 'جل خفيف' },
        { label: 'العطور', value: 'خالٍ من العطور' },
      ]),
    );
    expect(cmp.products[1].canOrder).toBe(false);
    expect(cmp.products[1].specs).toEqual(
      expect.arrayContaining([
        { label: 'SPF', value: '50+' },
        { label: 'المسام', value: 'لا يسد المسام' },
      ]),
    );
  });

  it('maps catalog sequence steps back to real sellable products', () => {
    const cleanser = product('Antioxidant Cleanser', 'cleanser-1', true);
    const routine = routineSequenceToPreview(
      {
        period: 'AM',
        steps: [{ position: 1, skuId: 'cleanser-1-sku', name: 'Antioxidant Cleanser', role: 'CLEANSER' }],
        excluded: [],
        notes: ['Apply on damp skin'],
        missing: ['SUNSCREEN'],
      },
      [cleanser],
      'AM',
      'ar',
    );
    expect(routine.source).toBe('catalog-sequence');
    expect(routine.steps[0].product?.price).toBe(105);
    expect(routine.notes).toEqual(['Apply on damp skin']);
  });
});
