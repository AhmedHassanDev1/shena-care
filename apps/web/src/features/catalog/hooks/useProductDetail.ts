'use client';

import { useQuery } from '@tanstack/react-query';
import { getProductDetail, type ProductDetail } from '../api/discovery';

/**
 * Loads full product detail directly from the discovery API.
 * The backend enforces availability, pricing, and merchandising truth.
 * Does not fall back to mock or fake data.
 */
export function useProductDetail(slug: string) {
  return useQuery<ProductDetail>({
    queryKey: ['product-detail', slug],
    queryFn: () => getProductDetail(slug),
    staleTime: 60_000,
  });
}
