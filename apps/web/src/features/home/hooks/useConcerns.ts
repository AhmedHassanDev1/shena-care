'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import { useAuth } from '@/features/auth/AuthContext';
import type { Concern } from '../lib/concerns';
import { isHomePreview } from '../lib/preview';
import { PREVIEW_CONCERNS } from '../mocks/concerns';

export type { Concern } from '../lib/concerns';

/**
 * Care concerns. `GET /care/concerns` requires a signed-in customer (the whole care controller is
 * guarded), so guests get none. Real concerns always win; only in design preview do fixtures fill in
 * when there are none, and outside preview the section is omitted.
 * TODO(API): Use a public concerns endpoint when one exists.
 */
export function useConcerns() {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: ['care', 'concerns'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const token = auth.getToken() ?? undefined;
      const concerns = await apiClient.get<Concern[]>('/care/concerns', { token });
      return concerns.filter((concern) => concern.isActive);
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const real = query.data ?? [];
  const isLoading = isAuthenticated && query.isLoading;
  const concerns = real.length > 0 || isLoading ? real : isHomePreview() ? PREVIEW_CONCERNS : [];
  return { concerns, isLoading };
}
