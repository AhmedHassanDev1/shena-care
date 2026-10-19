import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { sanitizeFilters, type DiscoveryFilters } from '../api/discovery';

/** A root department with its children (`GET /categories`, catalog-owned, active only). */
export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  children: Array<{ id: string; name: string; slug: string }>;
}

/** The listing state lives in the URL, so Back from a product page restores filters (PLPStates «العميل بيرجع لنفس المكان»). */
export function useListingFilters(): DiscoveryFilters {
  const params = useSearchParams();
  return useMemo(
    () =>
      sanitizeFilters({
        q: params.get('q') ?? undefined,
        brand: params.get('brand') ?? undefined,
        category: params.get('category') ?? undefined,
        productLine: params.get('productLine') ?? undefined,
        concern: params.get('concern') ?? undefined,
      }),
    [params],
  );
}

export function toQueryString(filters: DiscoveryFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useCategoryTree() {
  return useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: () => apiClient.get<CategoryNode[]>('/categories'),
    staleTime: 10 * 60 * 1000,
  });
}

/** The department (root category) a category slug belongs to, or null. */
export function departmentOf(slug: string | undefined, tree: CategoryNode[] | undefined): CategoryNode | null {
  if (!slug || !tree) return null;
  return tree.find((root) => root.slug === slug || root.children.some((child) => child.slug === slug)) ?? null;
}

/** What the listing header shows (PLPStates «سياق الصفحة»): the banner only on a department's first, unfiltered page. */
export type ListingContext =
  | { kind: 'department'; department: CategoryNode }
  | { kind: 'brand'; brand: string }
  | { kind: 'search'; q: string }
  | { kind: 'filtered'; department: CategoryNode | null }
  | { kind: 'all' };

export function listingContext(filters: DiscoveryFilters, tree: CategoryNode[] | undefined): ListingContext {
  const department = departmentOf(filters.category, tree);
  const extra = Boolean(filters.brand || filters.productLine || filters.concern);
  if (filters.q) return { kind: 'search', q: filters.q };
  if (filters.brand && !filters.category && !filters.productLine && !filters.concern) return { kind: 'brand', brand: filters.brand };
  if (department && filters.category === department.slug && !extra) return { kind: 'department', department };
  if (filters.category || extra) return { kind: 'filtered', department };
  return { kind: 'all' };
}
