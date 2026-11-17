'use client';

import { useQuery } from '@tanstack/react-query';
import { getConcernShelf, type ConcernShelfEntry } from '@/features/care/api/care-intelligence';

/**
 * The concerns the catalog can serve today (GET /guidance/concerns), shared by the hero dock and the concern atlas so
 * the homepage asks once. A concern with nothing to show is dropped; the list keeps the backend's order.
 */
export function useConcernShelf() {
  const query = useQuery({ queryKey: ['guidance', 'concerns'], queryFn: getConcernShelf, staleTime: 2 * 60 * 1000 });
  const concerns: ConcernShelfEntry[] = (query.data ?? []).filter((c) => c.productCount > 0 || c.heldForSafety);
  return { ...query, concerns };
}
