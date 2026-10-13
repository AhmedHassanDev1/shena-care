'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { resolveConcernsView } from '../lib/concerns';
import type { Concern, ConcernsView } from '../lib/concerns';
import { isHomePreview } from '../lib/preview';
import { PREVIEW_CONCERNS } from '../mocks/concerns';

export type { Concern } from '../lib/concerns';

export type ConcernsState =
  | Exclude<ConcernsView, { status: 'error' }>
  | { status: 'error'; retry: () => void; retrying: boolean };

/**
 * Care concerns from the public taxonomy (`GET /care/concerns`: active concerns only, no profile data), so
 * guests and customers see the same discovery options. See resolveConcernsView for how request states map to
 * what the section shows (a failure is never presented as an empty list).
 */
export function useConcerns(): ConcernsState {
  const query = useQuery({
    queryKey: ['care', 'concerns', 'public'],
    queryFn: () => apiClient.get<Concern[]>('/care/concerns'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const view = resolveConcernsView(query, { enabled: isHomePreview(), fixtures: PREVIEW_CONCERNS });
  if (view.status === 'error') return { status: 'error', retry: () => void query.refetch(), retrying: query.isFetching };
  return view;
}
