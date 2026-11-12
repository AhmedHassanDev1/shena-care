import { buildRoutineChoices } from './catalog-routine';
import type { ProductView } from '@/features/catalog/api/products';

const product = {
  id: 'product-1', name: 'Verified Cleanser', slug: 'verified-cleanser',
  brand: { id: 'brand-1', name: 'Brand', slug: 'brand' },
  skus: [{ id: 'sku-1', code: 'SKU-1', variantName: '200 ml', size: 200, sizeUnit: 'ml',
    price: { amount: 105, currency: 'EGP', compareAtAmount: null }, canOrder: true }],
  media: [{ id: 'media-1', skuId: 'sku-1', type: 'IMAGE', url: 'https://example.com/real.jpg', altText: null, isPrimary: true }],
} as ProductView;

describe('live routine choices', () => {
  it('joins only published catalog SKUs with a matching routine profile and current commerce data', () => {
    const choices = buildRoutineChoices([product], [
      { skuId: 'obsolete-sku', routineDomain: 'SKIN', primaryRole: 'SERUM', primaryRoleStatus: 'VERIFIED' },
      { skuId: 'sku-1', routineDomain: 'SKIN', primaryRole: 'CLEANSER', primaryRoleStatus: 'RULE_DERIVED' },
    ]);

    expect(choices).toEqual([{ skuId: 'sku-1', slug: 'verified-cleanser', name: 'Verified Cleanser', brand: 'Brand',
      variantName: '200 ml', size: 200, sizeUnit: 'ml', price: 105, currency: 'EGP', canOrder: true,
      imageUrl: 'https://example.com/real.jpg', role: 'CLEANSER', roleStatus: 'RULE_DERIVED', domain: 'SKIN' }]);
  });

  it('does not create a routine choice when the live SKU has no profile', () => {
    expect(buildRoutineChoices([product], [])).toEqual([]);
  });
});
