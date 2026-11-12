import type { ProductDetail, PublicVariant } from '../api/discovery';
import type { ProductView } from '../api/products';
import { rankRelatedProducts, selectRelatedProducts } from './related-products';

const DEFAULT_VARIANT: PublicVariant = {
  id: 'curr-sku-1',
  code: 'CURR-1',
  barcode: null,
  variantName: '50 ml',
  size: 50,
  sizeUnit: 'ml',
  price: { amount: 250, currency: 'EGP', compareAtAmount: null },
  canOrder: true,
  isAvailable: true,
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
};

function makeCandidate(overrides: Partial<ProductView> & { id: string; slug: string; name: string }): ProductView {
  return {
    description: null,
    usage: null,
    warnings: null,
    brand: { id: 'b-1', name: 'Brand', slug: 'brand' },
    category: { id: 'c-1', name: 'Moisturizers', slug: 'moisturizers', parentId: 'skin-parent' },
    productLine: null,
    skus: [
      {
        id: `${overrides.id}-sku`,
        code: `${overrides.id}-SKU`,
        variantName: '50 ml',
        size: 50,
        sizeUnit: 'ml',
        price: { amount: 250, currency: 'EGP', compareAtAmount: null },
        canOrder: true,
      },
    ],
    media: [],
    ...overrides,
  };
}

function makeCurrent(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 'curr-1',
    slug: 'curr-cream',
    name: 'Rejuvenation Cream',
    description: 'Hydrating daily cream for sensitive skin',
    usage: null,
    warnings: null,
    benefits: [],
    suitableSkinTypes: ['sensitive'],
    suitableHairTypes: [],
    brand: { id: 'b-1', name: 'Shaan', slug: 'shaan' },
    category: { id: 'c-1', name: 'Moisturizers', slug: 'moisturizers', parentId: 'skin-parent' },
    productLine: null,
    skus: [DEFAULT_VARIANT],
    media: [],
    selectedSkuId: DEFAULT_VARIANT.id,
    selectedVariant: DEFAULT_VARIANT,
    evaluatedAt: '2026-11-11T00:00:00Z',
    ...overrides,
  };
}

describe('selectRelatedProducts', () => {
  it('excludes the viewed product and repeated products while keeping catalog order', () => {
    const products = [
      { id: 'current', slug: 'current' },
      { id: 'a', slug: 'a' },
      { id: 'a', slug: 'a' },
      { id: 'b', slug: 'b' },
    ];
    expect(selectRelatedProducts(products, 'current', 2).map((product) => product.id)).toEqual(['a', 'b']);
  });
});

describe('rankRelatedProducts', () => {
  it('excludes current product/duplicates, prioritizes same category & concerns, and excludes cross-domain items', () => {
    const current = makeCurrent();
    const candidates: ProductView[] = [
      makeCandidate({ id: 'curr-1', slug: 'curr-cream', name: 'Rejuvenation Cream' }),
      makeCandidate({
        id: 'hair-1',
        slug: 'hair-shampoo',
        name: 'Moisture Shampoo',
        category: { id: 'c-h', name: 'Shampoos', slug: 'shampoos', parentId: 'hair-parent' },
      }),
      makeCandidate({
        id: 'serum-1',
        slug: 'serum-1',
        name: 'Calming Serum',
        description: 'Formulated for sensitive skin',
        category: { id: 'c-s', name: 'Serums', slug: 'serums-treatments', parentId: 'skin-parent' },
        brand: { id: 'b-2', name: 'Eva', slug: 'eva' },
      }),
      makeCandidate({
        id: 'moist-1',
        slug: 'moist-1',
        name: 'Soothing Gel',
        category: { id: 'c-1', name: 'Moisturizers', slug: 'moisturizers', parentId: 'skin-parent' },
      }),
      makeCandidate({
        id: 'moist-1-dup',
        slug: 'moist-1',
        name: 'Soothing Gel',
        category: { id: 'c-1', name: 'Moisturizers', slug: 'moisturizers', parentId: 'skin-parent' },
      }),
    ];

    const ranked = rankRelatedProducts(candidates, current, 4);
    expect(ranked.map((item) => item.id)).toEqual(['moist-1', 'serum-1']);
  });

  it('returns empty array when no genuine domain/category/concern relation exists', () => {
    const current = makeCurrent({
      id: 'hair-cond',
      slug: 'hair-cond',
      name: 'Hair Conditioner',
      description: 'Hair repair',
      suitableSkinTypes: [],
      category: { id: 'c-hc', name: 'Conditioners', slug: 'conditioners', parentId: 'hair-parent' },
    });
    const skinOnly = [
      makeCandidate({
        id: 'sun-1',
        slug: 'sun-1',
        name: 'Sunscreen SPF 50',
        category: { id: 'c-sun', name: 'Sunscreens', slug: 'sunscreens', parentId: 'skin-parent' },
      }),
    ];

    expect(rankRelatedProducts(skinOnly, current, 4)).toEqual([]);
  });
});
