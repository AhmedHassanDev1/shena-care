import type { RecommendedItem } from '../api/care-intelligence';
import { leadReasons, recommendationToCard } from './recommendation-card';

const item: RecommendedItem = {
  productId: 'p1', skuId: 'sku-1', slug: 'oil-control-cleanser', name: 'Oil Control Cleanser', brand: 'Eva', brandSlug: 'eva',
  productType: 'cleanser', role: 'CLEANSER', careArea: 'skin', variantName: '200 ml', sizeLabel: '200 ml', size: 200, sizeUnit: 'ml',
  imageUrl: 'https://cdn.example/p1.webp', category: { slug: 'cleansers', name: 'Cleansers' },
  price: { amount: 185, currency: 'EGP', compareAtAmount: null }, canOrder: true, matchLevel: 'STRONG',
  reasons: [
    { code: 'CONCERN_TAG', basis: 'RULE', text: 'Listed for this concern' },
    { code: 'TYPE_REQUESTED', basis: 'RULE', text: 'The type you asked for' },
    { code: 'SKIN_TYPE', basis: 'VERIFIED', text: 'Manufacturer states oily skin' },
    { code: 'TYPE_FOR_CONCERN', basis: 'EVIDENCE', text: 'A gentle foaming wash suits oily skin' },
  ],
  cautions: [], unknowns: [], keyActives: [], usage: { text: 'Use on wet skin', period: null, verified: false },
};

describe('recommendation → shared product card', () => {
  it('renders exactly the recommended orderable SKU at its Commerce price', () => {
    const card = recommendationToCard(item, 'ar');
    expect(card).toMatchObject({ id: 'p1', slug: 'oil-control-cleanser', brandName: 'Eva', imageUrl: 'https://cdn.example/p1.webp', unavailable: false });
    expect(card.price).toEqual({ amount: 185, currency: 'EGP' });
    expect(card.variants).toEqual([expect.objectContaining({ skuId: 'sku-1', canOrder: true })]);
  });

  it('shows no picture rather than inventing one when the catalog has none', () => {
    expect(recommendationToCard({ ...item, imageUrl: null }, 'en').imageUrl).toBeNull();
  });

  it('leads with evidence and verified facts, never the bare catalog tag', () => {
    expect(leadReasons(item).map((reason) => reason.code)).toEqual(['TYPE_FOR_CONCERN', 'SKIN_TYPE']);
    expect(leadReasons(item, 5).map((reason) => reason.code)).not.toContain('CONCERN_TAG');
  });
});
