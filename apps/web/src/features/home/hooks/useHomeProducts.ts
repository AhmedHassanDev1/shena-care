'use client';

import { useQuery } from '@tanstack/react-query';
import { discoverProducts, type DiscoveryPage } from '@/features/catalog/api/discovery';

/**
 * One discovery request feeds every data-driven homepage section (hero shelf, selected products, brand list), so the
 * page costs a single API call. The backend applies every sellability gate; the page only renders.
 * Empty results and API errors reach the page so it can show its existing empty and retry states.
 */
export function useHomeProducts() {
  return useQuery<DiscoveryPage>({
    queryKey: ['home', 'discovery'],
    queryFn: () => discoverProducts({}, undefined, 8),
    staleTime: 60_000,
  });
}
