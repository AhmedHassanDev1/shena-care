import type { ProductView } from '@/features/catalog/api/products';
import { toCardModel, type CardModel } from '@/features/catalog/lib/card-model';
import type { Locale } from '@/lib/i18n/messages';
import type { RecommendedItem } from '../api/care-intelligence';

/**
 * A recommended item rendered by the shared ProductCard: the engine already resolved the exact orderable SKU and its
 * Commerce price, so the card shows that one variant and Quick Add adds exactly it. Nothing is invented: every field
 * comes from the API response.
 */
export function recommendationToProductView(item: RecommendedItem): ProductView {
  return {
    id: item.productId,
    name: item.name,
    slug: item.slug,
    description: null,
    usage: item.usage.text,
    warnings: null,
    brand: { id: item.brandSlug, name: item.brand, slug: item.brandSlug },
    category: item.category ? { id: item.category.slug, name: item.category.name, slug: item.category.slug, parentId: null } : null,
    productLine: null,
    skus: [{
      id: item.skuId, code: item.skuId, variantName: item.variantName ?? '', size: item.size, sizeUnit: item.sizeUnit,
      price: item.price, canOrder: item.canOrder,
    }],
    media: item.imageUrl ? [{ id: `${item.productId}-primary`, type: 'image', url: item.imageUrl, altText: null, isPrimary: true }] : [],
  };
}

export function recommendationToCard(item: RecommendedItem, locale: Locale, or?: string): CardModel {
  return toCardModel(recommendationToProductView(item), locale, or);
}

/** The reasons a shopper reads first: evidence and verified facts before store rules, at most `max`. */
export function leadReasons(item: RecommendedItem, max = 2) {
  const rank = { EVIDENCE: 0, VERIFIED: 1, RULE: 2 } as const;
  return [...item.reasons]
    .filter((reason) => reason.code !== 'CONCERN_TAG')
    .sort((a, b) => rank[a.basis] - rank[b.basis])
    .slice(0, max);
}
