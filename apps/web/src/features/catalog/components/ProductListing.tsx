'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductGrid } from '@/features/home/components/ProductGrid';
import { toProductCardModel } from '@/features/home/lib/products';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { apiClient } from '@/lib/api-client';
import { mainCategorySlugs } from '@/lib/routes';
import type { Concern } from '@/features/home/lib/concerns';
import {
  discoverProducts,
  facetDisplayName,
  FILTER_KEYS,
  sanitizeFilters,
  withoutFacet,
  type DiscoveryFacet,
  type DiscoveryFilters,
  type DiscoveryPage,
  type FilterKey,
} from '../api/discovery';

const PAGE_SIZE = 20;
const FACET_OF: Record<FilterKey, keyof DiscoveryPage['facets']> = {
  brand: 'brands',
  category: 'categories',
  productLine: 'productLines',
};

function useFilters(): DiscoveryFilters {
  const params = useSearchParams();
  return useMemo(
    () => sanitizeFilters({
        q: params.get('q') ?? undefined,
        brand: params.get('brand') ?? undefined,
        category: params.get('category') ?? undefined,
        productLine: params.get('productLine') ?? undefined,
        concern: params.get('concern') ?? undefined,
      }),
    [params],
  );
}

function toQueryString(filters: DiscoveryFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Product listing over GET /products/discovery. The URL is the state (search, filters), so Back from a
 * product page restores it; facets and totals come from the backend after every sellability gate.
 * Pages load explicitly with "Show more" (cursor), never as an endless feed.
 */
export function ProductListing() {
  const m = useMessages();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useFilters();
  const concerns = useQuery({ queryKey: ['care', 'concerns', 'public'],
    queryFn: () => apiClient.get<Concern[]>('/care/concerns'), enabled: Boolean(filters.concern), staleTime: 5 * 60 * 1000 });
  const concernName = concerns.data?.find(concern => concern.slug === filters.concern)?.name ?? filters.concern ?? '';
  const filterKey = toQueryString(filters);

  const query = useInfiniteQuery({
    queryKey: ['discovery', filterKey],
    queryFn: ({ pageParam }) => discoverProducts(filters, pageParam, PAGE_SIZE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  const first = query.data?.pages[0];
  const products = useMemo(() => query.data?.pages.flatMap((page) => page.items).map(toProductCardModel) ?? [], [query.data]);

  const navigate = (next: DiscoveryFilters) => router.push(`${pathname}${toQueryString(next)}`, { scroll: false });
  // Root categories (the header's skin / hair links) are never facet values, so they take the header's labels.
  const rootCategoryNames = { [mainCategorySlugs.skin]: m.homeNavSkin, [mainCategorySlugs.hair]: m.homeNavHair };
  const facetName = (key: FilterKey, slug: string) =>
    facetDisplayName(slug, first?.facets[FACET_OF[key]], key === 'category' ? rootCategoryNames : undefined);
  const applied = FILTER_KEYS.filter((key) => filters[key]);

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Search lives in the shared site header, which submits to this route's `q`. */}
      <h1 className="text-display-m text-foreground">
        {filters.q ? fillMessage(m.listingResultsFor, { q: filters.q }) : m.listingTitle}
      </h1>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        <FilterSheet filters={filters} facets={first?.facets} onApply={navigate} appliedCount={applied.length + (filters.concern ? 1 : 0)} />
        {filters.concern ? (
          <Chip removable aria-label={fillMessage(m.listingRemoveFilter, { name: concernName })}
            onClick={() => navigate({ ...filters, concern: undefined })}>
            <bdi>{concernName}</bdi>
          </Chip>
        ) : null}
        {applied.map((key) => {
          const name = facetName(key, filters[key]!);
          return (
            <Chip
              key={key}
              removable
              aria-label={fillMessage(m.listingRemoveFilter, { name })}
              onClick={() => navigate({ ...filters, [key]: undefined })}
            >
              <bdi>{name}</bdi>
            </Chip>
          );
        })}
      </div>

      {query.status === 'pending' ? (
        <ListingSkeleton label={m.loading} />
      ) : query.status === 'error' ? (
        <Alert variant="destructive" className="items-center">
          <p className="flex-1 text-body-s">{m.productsError}</p>
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            {m.tryAgain}
          </Button>
        </Alert>
      ) : products.length === 0 ? (
        <section className="rounded-md border border-border bg-card px-5 py-8 text-center">
          <h2 className="text-heading text-foreground">{m.listingNoResultsTitle}</h2>
          <p className="mt-2 text-body-s text-muted-foreground">{m.listingNoResultsBody}</p>
          {filterKey ? (
            <Button variant="secondary" className="mt-4" onClick={() => navigate({})}>
              {m.listingClearAll}
            </Button>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="listing-count" className="space-y-4">
          <p id="listing-count" role="status" className="text-body-s text-ink-soft">
            {fillMessage(m.listingCount, { n: first?.total ?? products.length })}
          </p>
          <ProductGrid products={products} />
          <div className="flex flex-col items-center gap-3 pt-2">
            {query.isFetchNextPageError ? (
              <p role="alert" className="flex items-center gap-2 text-body-s text-destructive">
                <Icon name="alert" size={18} />
                {m.listingLoadMoreFailed}
              </p>
            ) : null}
            {query.hasNextPage ? (
              <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                {m.listingLoadMore}
              </Button>
            ) : (
              <p className="text-caption text-ink-subtle">{fillMessage(m.listingEnd, { n: first?.total ?? products.length })}</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ListingSkeleton({ label }: { label: string }) {
  return (
    <ul aria-busy="true" aria-label={label} className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 lg:gap-y-8">
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index}>
          <Skeleton shape="arch" className="aspect-[4/5] w-full" />
          <Skeleton shape="pill" className="mt-3 h-4 w-3/4" />
          <Skeleton shape="pill" className="mt-2 h-4 w-1/2" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Filter sheet: single choice per facet (the API takes one value each). The footer shows the real count
 * for the pending selection, fetched with limit 1, before the shopper applies it.
 */
function FilterSheet({
  filters,
  facets,
  onApply,
  appliedCount,
}: {
  filters: DiscoveryFilters;
  facets: DiscoveryPage['facets'] | undefined;
  onApply: (next: DiscoveryFilters) => void;
  appliedCount: number;
}) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DiscoveryFilters>(filters);
  const draftKey = toQueryString(draft);

  const preview = useQuery({
    queryKey: ['discovery-count', draftKey],
    queryFn: () => discoverProducts(draft, undefined, 1),
    enabled: open,
    staleTime: 60_000,
  });
  // Facets for the pending selection, so options stay consistent with what would be shown.
  const shown = (open && preview.data?.facets) || facets;
  // A facet with a chosen value lists its options from the draft without that value (counts still honour every
  // other filter), so the choice can be switched directly. Fetched only while the sheet is open and a value is set.
  const unchosen = useQueries({
    queries: FILTER_KEYS.map((key) => {
      const source = withoutFacet(draft, key);
      return {
        queryKey: ['discovery-count', toQueryString(source)],
        queryFn: () => discoverProducts(source, undefined, 1),
        enabled: open && Boolean(draft[key]),
        staleTime: 60_000,
      };
    }),
  });
  const optionsFor = (key: FilterKey): DiscoveryFacet[] =>
    (draft[key] && unchosen[FILTER_KEYS.indexOf(key)].data?.facets[FACET_OF[key]]) || shown?.[FACET_OF[key]] || [];

  const sections: Array<{ key: FilterKey; title: string; options: DiscoveryFacet[] }> = [
    { key: 'category', title: m.listingCategory, options: optionsFor('category') },
    { key: 'brand', title: m.listingBrand, options: optionsFor('brand') },
    { key: 'productLine', title: m.listingProductLine, options: optionsFor('productLine') },
  ];
  const visible = sections.filter((section) => section.options.length > 0 || draft[section.key]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(filters);
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Chip
          selected={appliedCount > 0}
          aria-label={appliedCount ? fillMessage(m.listingFiltersApplied, { n: appliedCount }) : m.listingFilters}
        >
          <span className="inline-flex items-center gap-2">
            <Icon name="filter" size={18} />
            {m.listingFilters}
            {appliedCount ? <bdi className="tabular-nums">{appliedCount}</bdi> : null}
          </span>
        </Chip>
      </SheetTrigger>
      <SheetContent side="bottom" closeLabel={m.listingCloseFilters} className="mx-auto w-full max-w-2xl">
        <SheetHeader>
          <SheetTitle>{m.listingFilters}</SheetTitle>
        </SheetHeader>
        <div className="-mx-6 flex-1 space-y-6 overflow-y-auto px-6">
          {visible.length === 0 ? <p className="text-body-s text-muted-foreground">{m.listingNoFacets}</p> : null}
          {visible.map((section) => (
            <fieldset key={section.key} className="space-y-3">
              <legend className="text-heading text-foreground">{section.title}</legend>
              <div className="flex flex-wrap gap-2">
                {section.options.map((option) => {
                  const selected = draft[section.key] === option.slug;
                  return (
                    <Chip
                      key={option.slug}
                      selected={selected}
                      count={option.count}
                      onClick={() => setDraft({ ...draft, [section.key]: selected ? undefined : option.slug })}
                    >
                      <bdi>{option.name}</bdi>
                    </Chip>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <SheetFooter className="flex-row gap-3 border-t border-border pt-4 sm:justify-between">
          <Button variant="secondary" className="flex-1" onClick={() => setDraft({ q: filters.q })}>
            {m.listingClearAll}
          </Button>
          <Button
            className="flex-1"
            loading={preview.isFetching}
            onClick={() => {
              setOpen(false);
              onApply(draft);
            }}
          >
            {preview.data ? fillMessage(m.listingShowResults, { n: preview.data.total }) : m.listingApply}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
