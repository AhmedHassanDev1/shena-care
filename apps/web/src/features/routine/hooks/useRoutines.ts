'use client';

import { useQuery } from '@tanstack/react-query';
import { getFeaturedRoutines } from '../services/routines.service';
import type { RoutineCardModel } from '../types/routine.types';

/**
 * Standard query hook for featured routines.
 * Follows the existing TanStack Query conventions used across the storefront.
 */
export function useFeaturedRoutines() {
  return useQuery<RoutineCardModel[]>({
    queryKey: ['routines', 'featured'],
    queryFn: getFeaturedRoutines,
    staleTime: 60_000,
  });
}
