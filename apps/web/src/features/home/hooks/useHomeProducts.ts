'use client';

import { useQuery } from '@tanstack/react-query';
import { discoverProducts } from '@/features/catalog/api/discovery';

/**
 * One discovery request feeds every data-driven homepage section (hero shelf, selected products, brand list), so the
 * page costs a single API call. The backend applies every sellability gate; the page only renders.
 */
export function useHomeProducts() {
  return useQuery({
    queryKey: ['home', 'discovery'],
    queryFn: () => discoverProducts({}, undefined, 8),
    staleTime: 60_000,
  });
}
