import { useQuery } from '@tanstack/react-query';
import { catalogEntries, type SkuCatalogEntry } from '@/lib/cart';

const EMPTY: Record<string, SkuCatalogEntry> = {};

/** Thumbnails and sizes for order lines; the order's own product names stay the record of what was bought. */
export function useSkuCatalog(skuIds: string[]): Record<string, SkuCatalogEntry> {
  const ids = [...new Set(skuIds)].sort();
  const query = useQuery({
    queryKey: ['sku-catalog', ids],
    queryFn: () => catalogEntries(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
  return query.data ?? EMPTY;
}
