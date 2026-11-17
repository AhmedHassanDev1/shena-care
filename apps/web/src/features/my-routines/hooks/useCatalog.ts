'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProducts } from '@/features/catalog/api/products';
import { getRecommendations } from '@/features/care/api/care-intelligence';
import { useLocale } from '@/lib/i18n/LocaleProvider';
import { buildOptions, fetchProfiles, optionFromRecommendation, type PickOption } from '../lib/catalog';
import type { CareArea } from '../api/personal-routines';

/**
 * Every published catalog variant as the picker and the step rows show it. Products (names, photos, prices) arrive first;
 * routine roles and time-of-day hints from the routine-profile API fill in when they are ready, so photos never wait on them.
 */
export function useRoutineCatalog() {
  const products = useQuery({
    queryKey: ['my-routines', 'products'],
    queryFn: () => getProducts(),
    staleTime: 60_000,
    retry: 1,
  });
  const profiles = useQuery({
    queryKey: ['my-routines', 'profiles'],
    enabled: !!products.data,
    queryFn: () => fetchProfiles(products.data!.flatMap((product) => product.skus.map((sku) => sku.id))),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const options = useMemo(() => (products.data ? buildOptions(products.data, profiles.data ?? []) : []), [products.data, profiles.data]);
  const bySku = useMemo(() => new Map(options.map((option) => [option.skuId, option])), [options]);
  return {
    options,
    bySku,
    isPending: products.isPending,
    isError: products.isError,
    refetch: products.refetch,
    /** Roles and period hints are still loading; the list is usable without them. */
    profilesPending: profiles.isPending && !!products.data,
  };
}

/**
 * The recommendation engine's suggestions for the care area (POST /guidance/recommendations). The engine applies the
 * customer's saved safety answers itself; this only shows what it returned, with its own reason text.
 */
export function useSuggestions(careArea: CareArea, known: Map<string, PickOption>, enabled: boolean) {
  const locale = useLocale();
  const area = careArea === 'hair' ? 'hair' : 'skin';
  return useQuery({
    queryKey: ['my-routines', 'suggestions', area, locale],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await getRecommendations({ careArea: area, perTypeLimit: 2, limit: 8, locale }, signal);
      return result.items.map((item) => optionFromRecommendation(item, known));
    },
  });
}
