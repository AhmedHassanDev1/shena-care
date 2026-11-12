import { useQuery } from '@tanstack/react-query';
import { discoverProducts, type ProductDetail } from '../api/discovery';
import type { ProductView } from '../api/products';
import { rankRelatedProducts } from '../lib/related-products';

/**
 * Fetches real catalog products and selects genuinely related items
 * using existing discovery APIs without custom recommendation tables or mocks.
 */
export function useRelatedProducts(product: ProductDetail, limit = 8) {
  const categorySlug = product.category?.slug ?? null;

  return useQuery<ProductView[]>({
    queryKey: ['products', 'related', product.id, categorySlug, limit],
    staleTime: 60_000,
    queryFn: async () => {
      const pool = new Map<string, ProductView>();

      if (categorySlug) {
        const sameCategoryPage = await discoverProducts(
          { category: categorySlug },
          undefined,
          12
        );
        for (const item of sameCategoryPage.items) {
          pool.set(item.id, item);
        }
      }

      const excludingCurrentCount = [...pool.values()].filter(
        (item) => item.id !== product.id && item.slug !== product.slug
      ).length;

      if (excludingCurrentCount < limit) {
        const discoveryPage = await discoverProducts({}, undefined, 24);
        for (const item of discoveryPage.items) {
          if (!pool.has(item.id)) {
            pool.set(item.id, item);
          }
        }
      }

      return rankRelatedProducts([...pool.values()], product, limit);
    },
  });
}
