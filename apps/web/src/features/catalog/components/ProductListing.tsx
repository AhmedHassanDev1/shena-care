'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api-client';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { discoverProducts, withoutFacet, type Concern, type DiscoveryFacet, type DiscoveryFilters, type DiscoveryPage } from '../api/discovery';
import { categoryLabel, toCardModel } from '../lib/card-model';
import { departmentOf, listingContext, toQueryString, useCategoryTree, useListingFilters } from '../lib/listing';
import { ProductCard, ProductCardSkeleton } from './ProductCard';
import { AppliedFilters, type AppliedFilter } from './plp/AppliedFilters';
import { FilterPanel, type FacetGroups } from './plp/FilterPanel';
import { PlpHeader } from './plp/PlpHeader';

/** Board grid: 12 visible before the next page (PLP «١٥ منتج · ظاهر ١٢»). */
const PAGE_SIZE = 12;

/** One facet's options, counted with every OTHER filter applied (so a chosen value can be switched directly). */
function useFacet(filters: DiscoveryFilters, key: 'category' | 'brand', current: DiscoveryPage | undefined, base?: DiscoveryFilters): DiscoveryFacet[] {
  const source = base ?? withoutFacet(filters, key);
  const needsOwn = Boolean(filters[key]) || Boolean(base);
  const query = useQuery({
    queryKey: ['discovery', 'facet', key, toQueryString(source)],
    queryFn: () => discoverProducts(source, undefined, 1),
    enabled: needsOwn,
    staleTime: 60_000,
  });
  const facets = needsOwn ? query.data?.facets : current?.facets;
  return (key === 'category' ? facets?.categories : facets?.brands) ?? [];
}

/**
 * PLP / search (boards PLP, PLPMobile, PLPMobileScrolled, PLPStates) over GET /products/discovery. The URL is the
 * state; facets, counts and totals come from the backend after every sellability gate. Infinite scroll loads the next
 * cursor page when the end of the grid comes into view, with a skeleton row, a written status and progress
 * («بنحمّل باقي المنتجات…», «شفت ١٢ من ١٥ منتج») and a keyboard alternative «اعرض … منتجات كمان».
 */
export function ProductListing() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useListingFilters();
  const tree = useCategoryTree();
  const key = toQueryString(filters);
  const context = listingContext(filters, tree.data);
  const department = departmentOf(filters.category, tree.data);
  // Until the department tree arrives, a category cannot be told apart from a filter: hold the header and chips.
  const treeReady = !filters.category || !tree.isPending;

  const query = useInfiniteQuery({
    queryKey: ['discovery', 'list', key],
    queryFn: ({ pageParam }) => discoverProducts(filters, pageParam, PAGE_SIZE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  const first = query.data?.pages[0];
  const total = first?.total ?? null;
  const products = useMemo(
    () => query.data?.pages.flatMap((page) => page.items).map((p) => toCardModel(p, locale, m.sizeOr)) ?? [],
    [query.data, locale, m.sizeOr]
  );

  // «النوع» lists the department's child categories; with no department, every category the results carry.
  const typeBase = department ? { ...filters, category: department.slug } : undefined;
  const groups: FacetGroups = {
    type: useFacet(filters, 'category', first, typeBase).filter((f) => !tree.data?.some((root) => root.slug === f.slug)),
    brand: useFacet(filters, 'brand', first),
  };
  const deptTotal = useQuery({
    queryKey: ['discovery', 'facet', 'total', toQueryString(typeBase ?? {})],
    queryFn: () => discoverProducts(typeBase!, undefined, 1),
    enabled: Boolean(typeBase),
    staleTime: 60_000,
  }).data?.total;

  const concerns = useQuery({
    queryKey: ['care', 'concerns', 'public'],
    queryFn: () => apiClient.get<Concern[]>('/care/concerns'),
    enabled: Boolean(filters.concern),
    staleTime: 5 * 60 * 1000,
  });

  const navigate = (next: DiscoveryFilters) => router.push(`${pathname}${toQueryString(next)}`, { scroll: false });
  const clearAll = () => navigate({ q: filters.q, category: department && context.kind !== 'search' ? department.slug : undefined });

  const isRoot = (slug: string | undefined) => Boolean(slug && tree.data?.some((r) => r.slug === slug));
  const applied: AppliedFilter[] = [];
  if (treeReady && filters.category && !isRoot(filters.category)) {
    const facet = groups.type.find((f) => f.slug === filters.category);
    applied.push({
      key: 'category',
      label: categoryLabel(facet ?? { slug: filters.category, name: filters.category }, locale) ?? filters.category,
      onRemove: () => navigate({ ...filters, category: department?.slug }),
    });
  }
  if (filters.brand && context.kind !== 'brand') {
    const facet = groups.brand.find((f) => f.slug === filters.brand);
    applied.push({ key: 'brand', label: (facet?.name ?? filters.brand).toUpperCase(), latin: true, onRemove: () => navigate({ ...filters, brand: undefined }) });
  }
  if (filters.concern) {
    applied.push({
      key: 'concern',
      label: concerns.data?.find((c) => c.slug === filters.concern)?.name ?? filters.concern,
      onRemove: () => navigate({ ...filters, concern: undefined }),
    });
  }

  const showRail = context.kind !== 'search' || products.length > 0;

  return (
    <div className="flex flex-col gap-6 pb-14 lg:gap-10">
      {treeReady ? (
        <PlpHeader context={context} total={total} prints={products.slice(0, 2)} tree={tree.data} filters={filters} onNavigate={navigate} />
      ) : (
        <Skeleton className="h-[160px] rounded-24 lg:h-[212px] lg:rounded-sheet" />
      )}

      {/* Smart Search Understanding Banner from Stitch Screen 9 */}
      {filters.q ? (
        <div className="flex flex-col gap-3 rounded-card bg-sand/60 p-4 shadow-outline-hairline lg:p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 flex-none items-center justify-center rounded-full bg-bottle-tint text-bottle">
              <Icon name="sparkles" size={18} />
            </span>
            <div className="flex flex-col">
              <span className="font-display text-15 font-bold leading-22 text-night">
                {fillMessage(m.plpSmartSearchQueryUnderstanding, { query: filters.q })}
              </span>
              <span className="text-12 leading-18 text-ink-2">
                {m.plpSmartSearchTagline}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="rounded-full bg-linen px-2.5 py-1 text-11.5 font-semibold text-night shadow-elevation-1">
              تركيبات خالية من العطور
            </span>
            <span className="rounded-full bg-linen px-2.5 py-1 text-11.5 font-semibold text-night shadow-elevation-1">
              تراكيز علاجية مثبتة
            </span>
            <span className="rounded-full bg-linen px-2.5 py-1 text-11.5 font-semibold text-night shadow-elevation-1">
              مستوى حموضة متوازن pH
            </span>
          </div>
        </div>
      ) : null}

      {/* Phone: quick type pills, then the sticky «فلترة» bar (PLPMobile, PLPMobileScrolled). */}
      <div className="flex flex-col gap-3 lg:hidden">
        {department && groups.type.length ? (
          <div role="group" aria-label={m.plpType} className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1.5 scrollbar-none">
            <Chip selected={filters.category === department.slug} count={deptTotal !== undefined ? formatNumber(deptTotal, locale) : undefined} onClick={() => navigate({ ...filters, category: department.slug })}>
              {m.plpAll}
            </Chip>
            {groups.type.map((f) => (
              <Chip key={f.slug} selected={filters.category === f.slug} count={formatNumber(f.count, locale)} onClick={() => navigate({ ...filters, category: f.slug })}>
                {categoryLabel(f, locale)}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="sticky top-0 z-sticky -mx-4 bg-bone/95 px-4 py-2 backdrop-blur-sm">
          <MobileFilterSheet filters={filters} groups={groups} applied={applied.length} onApply={navigate} clearTo={() => clearAll()} />
        </div>
        <AppliedFilters filters={applied} onClearAll={clearAll} />
      </div>

      <div className="flex items-start gap-10">
        {showRail ? (
          <aside aria-labelledby="flt-h" className="sticky top-6 hidden w-[272px] flex-none self-start lg:block">
            <div className="flex min-h-control-m items-center justify-between pb-1 shadow-hairline-bottom">
              <h2 id="flt-h" className="m-0 inline-flex items-center gap-2 font-display text-22 font-bold leading-28">
                {m.plpFilters}
                {applied.length ? (
                  <span className="inline-flex size-5.5 items-center justify-center rounded-full bg-bottle font-text text-12 font-bold text-white">
                    {formatNumber(applied.length, locale)}
                  </span>
                ) : null}
              </h2>
              {applied.length ? (
                <button type="button" onClick={clearAll} className="min-h-control-s bg-transparent text-14 font-semibold text-bottle underline underline-offset-4">
                  {m.plpClearAll}
                </button>
              ) : null}
            </div>
            <FilterPanel variant="rail" value={filters} onChange={navigate} groups={groups} />
          </aside>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="mb-7 hidden flex-col gap-4 pb-4 shadow-hairline-bottom lg:flex">
            <p role="status" aria-live="polite" className="m-0 text-15 font-bold leading-24">
              {total !== null ? fillMessage(m.plpCount, { n: formatNumber(total, locale) }) : ' '}
              {total !== null && products.length < total ? (
                <span className="font-medium text-ink-2">{fillMessage(m.plpShown, { n: formatNumber(products.length, locale) })}</span>
              ) : null}
            </p>
            <AppliedFilters filters={applied} onClearAll={clearAll} />
          </div>
          <p role="status" aria-live="polite" className="m-0 mb-3 text-15 font-bold leading-24 lg:hidden">
            {total !== null ? fillMessage(m.plpCount, { n: formatNumber(total, locale) }) : null}
            {total !== null && products.length < total ? <span className="font-medium text-ink-2">{fillMessage(m.plpShown, { n: formatNumber(products.length, locale) })}</span> : null}
          </p>

          {query.status === 'pending' ? (
            <Grid>{Array.from({ length: 6 }, (_, i) => <ProductCardSkeleton key={i} />)}</Grid>
          ) : query.status === 'error' ? (
            <div role="alert" className="flex flex-col items-center gap-4 rounded-card bg-err-tint px-6 py-8 text-center">
              <p className="m-0 font-display text-21 font-bold leading-27 text-err">{m.plpLoadError}</p>
              <Button variant="light" size="m" onClick={() => query.refetch()}>
                {m.plpRetry}
              </Button>
            </div>
          ) : products.length === 0 ? (
            <ListingEmpty context={context.kind} q={filters.q} hasFilters={applied.length > 0} filters={applied} onClear={clearAll} department={department?.slug} />
          ) : (
            <>
              <Grid>
                {products.map((product, index) => (
                  <ProductCard key={product.id} product={product} priority={index < 3} />
                ))}
                {query.isFetchingNextPage ? Array.from({ length: 3 }, (_, i) => <ProductCardSkeleton key={`s${i}`} />) : null}
              </Grid>
              <InfiniteStatus
                shown={products.length}
                total={total ?? products.length}
                hasNext={Boolean(query.hasNextPage)}
                loading={query.isFetchingNextPage}
                failed={query.isFetchNextPageError}
                onMore={() => query.fetchNextPage()}
                where={context.kind === 'department' ? categoryLabel(context.department, locale) ?? context.department.name : null}
              />

              {/* Pharmaceutical Trust & Expiry Guarantee Callout from Stitch Screen 2 */}
              <div className="mt-12 flex flex-col items-center gap-4 rounded-card bg-linen p-6 text-center shadow-outline-hairline sm:flex-row sm:items-start sm:p-7 sm:text-start">
                <span className="flex size-11 flex-none items-center justify-center rounded-full bg-bottle-tint text-bottle">
                  <Icon name="shield" size={22} />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="m-0 font-display text-16 font-bold text-night">
                    {m.plpCatalogTrustTitle}
                  </h3>
                  <p className="m-0 text-13.5 leading-22 text-ink-2">
                    {m.plpCatalogTrustBody}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-8 lg:grid-cols-3 lg:gap-x-6 lg:gap-y-12">{children}</div>;
}

function InfiniteStatus({ shown, total, hasNext, loading, failed, onMore, where }: {
  shown: number; total: number; hasNext: boolean; loading: boolean; failed: boolean; onMore: () => void; where: string | null;
}) {
  const m = useMessages();
  const locale = useLocale();
  const sentinel = useRef<HTMLDivElement>(null);
  const n = (v: number) => formatNumber(v, locale);

  // Load the next page when the end of the grid comes into view (not when a load failed: that waits for «جرّب تاني»).
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNext || failed) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && !loading && onMore(), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNext, failed, loading, onMore]);

  if (failed) {
    return (
      <div role="alert" className="mx-auto mt-10 flex max-w-[280px] flex-col items-center gap-3 rounded-card bg-err-tint px-6 py-6 text-center">
        <p className="m-0 font-display text-17 font-bold leading-24 text-err">{m.plpMoreFailed}</p>
        <p className="m-0 text-14 leading-22 text-night">{fillMessage(m.plpMoreFailedBody, { n: n(shown) })}</p>
        <Button variant="light" size="s" onClick={onMore}>
          {m.plpRetry}
        </Button>
      </div>
    );
  }
  if (hasNext) {
    const pct = total ? Math.min(100, Math.round((shown / total) * 100)) : 0;
    return (
      <div ref={sentinel} className="mt-10 flex flex-col items-center gap-3">
        {loading ? (
          <p role="status" className="m-0 flex items-center gap-2.5 text-14 font-semibold">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" className="text-bottle motion-safe:animate-spin">
              <circle cx="12" cy="12" r="8" opacity=".25" />
              <path d="M20 12a8 8 0 0 0-8-8" />
            </svg>
            {m.plpLoading}
          </p>
        ) : null}
        <div aria-hidden="true" className="h-1 w-[220px] overflow-hidden rounded-pill bg-dune">
          <div className="h-full rounded-pill bg-night" style={{ width: `${pct}%` }} />
        </div>
        <p className="m-0 text-12.5 leading-19 text-ink-2">{fillMessage(m.plpSeen, { shown: n(shown), total: n(total) })}</p>
        {loading ? null : (
          <Button variant="light" size="m" onClick={onMore}>
            {fillMessage(m.plpShowMore, { n: n(Math.min(PAGE_SIZE, total - shown)) })}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="mx-auto mt-12 flex max-w-[300px] flex-col items-center gap-3 text-center">
      <span aria-hidden="true" className="h-1 w-[180px] rounded-pill bg-night" />
      <p className="m-0 font-display text-24 font-bold leading-30">{fillMessage(m.plpEndTitle, { n: n(total) })}</p>
      <p className="m-0 text-14 leading-22 text-ink-2">{where ? fillMessage(m.plpEndBody, { where }) : m.plpEndBodyFiltered}</p>
      <Button variant="light" size="m" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        {m.plpBackToTop}
      </Button>
      <Button asChild variant="ink" size="m">
        <Link href={routes.products}>{m.plpAllBrands}</Link>
      </Button>
    </div>
  );
}

function ListingEmpty({ context, q, hasFilters, filters, onClear, department }: {
  context: string; q?: string; hasFilters: boolean; filters: AppliedFilter[]; onClear: () => void; department?: string;
}) {
  const m = useMessages();
  const locale = useLocale();
  const total = useQuery({
    queryKey: ['discovery', 'facet', 'total', department ?? 'all'],
    queryFn: () => discoverProducts(department ? { category: department } : {}, undefined, 1),
    enabled: hasFilters,
  }).data?.total;
  const box = 'flex flex-col items-start gap-4 rounded-card bg-linen p-6 shadow-outline-hairline lg:p-8';

  if (context === 'search' && q) {
    return (
      <section className={box}>
        <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-sand text-night">
          <Icon name="search" size={22} />
        </span>
        <h2 className="m-0 text-display-3">{fillMessage(m.plpNoResultsTitle, { q })}</h2>
        <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-14.5 leading-24 text-ink-2">
          <li>{m.plpNoResultsTip1}</li>
          <li>{m.plpNoResultsTip2}</li>
        </ul>
        <p className="m-0 text-13 font-semibold">{m.plpOrBrowse}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="light" size="s">
            <Link href={routes.productsByCategory(mainCategorySlugs.skin)}>{m.homeNavSkin}</Link>
          </Button>
          <Button asChild variant="light" size="s">
            <Link href={routes.productsByCategory(mainCategorySlugs.hair)}>{m.homeNavHair}</Link>
          </Button>
          <Button asChild variant="light" size="s">
            <Link href={routes.products}>{m.plpAllBrands}</Link>
          </Button>
        </div>
      </section>
    );
  }
  if (hasFilters) {
    return (
      <section className={box}>
        <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-sand text-night">
          <Icon name="filter" size={22} />
        </span>
        <h2 className="m-0 text-display-3">{m.plpNoFilterTitle}</h2>
        <AppliedFilters filters={filters} onClearAll={onClear} />
        <Button variant="light" size="m" onClick={onClear}>
          {total !== undefined ? fillMessage(m.plpClearFilters, { n: formatNumber(total, locale) }) : m.plpClearAll}
        </Button>
      </section>
    );
  }
  return (
    <section className={cn(box, 'items-center text-center')}>
      <h2 className="m-0 text-display-3">{m.plpEmptyDeptTitle}</h2>
      <p className="m-0 text-14 leading-22 text-ink-2">{m.plpEmptyDeptBody}</p>
      <div className="flex flex-col gap-2">
        <Button asChild variant="light" size="s">
          <Link href={routes.productsByCategory(mainCategorySlugs.skin)}>{m.homeNavSkin}</Link>
        </Button>
        <Button asChild variant="light" size="s">
          <Link href={routes.productsByCategory(mainCategorySlugs.hair)}>{m.homeNavHair}</Link>
        </Button>
      </div>
    </section>
  );
}

function MobileFilterSheet({ filters, groups, applied, onApply, clearTo }: {
  filters: DiscoveryFilters; groups: FacetGroups; applied: number; onApply: (next: DiscoveryFilters) => void; clearTo: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DiscoveryFilters>(filters);
  const draftKey = toQueryString(draft);
  const preview = useQuery({
    queryKey: ['discovery', 'facet', 'draft', draftKey],
    queryFn: () => discoverProducts(draft, undefined, 1),
    enabled: open,
    staleTime: 60_000,
  });
  const draftApplied = [draft.category && groups.type.some((f) => f.slug === draft.category), draft.brand, draft.concern].filter(Boolean).length;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(filters);
        setOpen(next);
      }}
    >
      <button
        type="button"
        onClick={() => {
          setDraft(filters);
          setOpen(true);
        }}
        className="flex h-control-l w-full items-center justify-center gap-2.5 rounded-pill bg-night text-16 font-semibold text-linen"
      >
        <Icon name="filter" size={20} />
        {m.plpFilterButton}
        {applied ? (
          <span className="inline-flex size-5.5 items-center justify-center rounded-full bg-bottle text-12 font-bold text-white">{formatNumber(applied, locale)}</span>
        ) : null}
      </button>
      <SheetContent side="bottom" closeLabel={m.close} className="rounded-t-24">
        <span aria-hidden="true" className="mt-2 h-1 w-10 self-center rounded-4 bg-dune" />
        <SheetHeader className="pb-2 pt-2 shadow-hairline-bottom">
          <SheetTitle className="flex items-center gap-2 font-display text-24 font-bold leading-30">
            {m.plpFilters}
            {draftApplied ? <span className="font-text text-14 font-medium text-ink-2">{fillMessage(m.plpSelected, { n: formatNumber(draftApplied, locale) })}</span> : null}
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <FilterPanel variant="sheet" value={draft} onChange={setDraft} groups={groups} />
        </div>
        <SheetFooter className="items-center">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              clearTo();
            }}
            className="min-h-control-s bg-transparent px-1 text-15 font-semibold text-night underline underline-offset-4"
          >
            {m.plpClearAll}
          </button>
          <Button
            variant="bottle"
            size="l"
            className="flex-1"
            onClick={() => {
              setOpen(false);
              onApply(draft);
            }}
          >
            {preview.data ? fillMessage(m.plpApply, { n: formatNumber(preview.data.total, locale) }) : m.plpApplyCounting}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
