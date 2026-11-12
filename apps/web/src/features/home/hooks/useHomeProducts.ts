'use client';

import { useQuery } from '@tanstack/react-query';
import { discoverProducts, type DiscoveryPage } from '@/features/catalog/api/discovery';

/**
 * Feeds the homepage products section directly from the discovery API.
 * The backend applies every sellability gate; the storefront only renders real products.
 * Does not fall back to mock or fake data.
 */
export function useHomeProducts() {
  return useQuery<DiscoveryPage>({
    queryKey: ['home', 'discovery'],
    queryFn: () => discoverProducts({}, undefined, 8),
    staleTime: 60_000,
  });
}
