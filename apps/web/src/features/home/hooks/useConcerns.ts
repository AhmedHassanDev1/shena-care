'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import { useAuth } from '@/features/auth/AuthContext';

export interface Concern {
  id: string;
  name: string;
  slug: string;
  careArea: 'skin' | 'hair';
  description: string | null;
  isActive: boolean;
}

/**
 * Care concerns. `GET /care/concerns` requires a signed-in customer (the whole care controller is
 * guarded), so guests get none and the section is omitted rather than filled with invented items.
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
  });
  return { concerns: query.data ?? [], isLoading: isAuthenticated && query.isLoading };
}
