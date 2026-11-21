'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { SearchField } from '@/components/ui/search-field';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { suggestProducts } from '../api/discovery';
import { categoryLabel } from '../lib/card-model';
import { buildSearchOptions, nextScrollTopForOptionVisibility, normalizeSearchQuery, readRecentSearches, rememberSearch, stepActiveIndex } from '../lib/search-helpers';

interface ProductSearchProps {
  id: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  mobile?: boolean;
}

const HISTORY_KEY = 'shinacare.search.session.v1';

/** Anchored desktop combobox and full-screen mobile search share the same public API. */
export function ProductSearch(props: ProductSearchProps) {
  const [open, setOpen] = useState(false);
  const m = useMessages();

  useEffect(() => {
    if (!props.mobile) return;
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };

    if (desktop.matches) setOpen(false);
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [props.mobile]);

  if (!props.mobile) return <SearchCombobox {...props} />;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" aria-label={props.label} className="flex min-h-11 w-full items-center gap-3 rounded-pill border border-line-2/30 bg-linen px-4 text-start text-14.5 text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt">
          <Icon name="search" size={18} /><span className="truncate">{props.defaultValue || props.placeholder}</span>
        </button>
      </SheetTrigger>
      <SheetContent side="full" closeLabel={m.searchClose} aria-describedby={undefined}>
        <SheetTitle className="px-4 pb-4 pe-16 pt-4 text-title">{props.label}</SheetTitle>
        <div className="flex min-h-0 flex-1 flex-col px-4"><SearchCombobox {...props} onNavigate={() => setOpen(false)} /></div>
      </SheetContent>
    </Sheet>
  );
}

function SearchCombobox({ id, label, placeholder, defaultValue = '', mobile, onNavigate }: ProductSearchProps & { onNavigate?: () => void }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState(defaultValue);
  const [debounced, setDebounced] = useState('');
  const [focused, setFocused] = useState(Boolean(mobile));
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resultsPanelRef = useRef<HTMLDivElement>(null);
  const normalized = normalizeSearchQuery(query);
  const ready = normalized.length >= 2 && normalized === debounced;

  useEffect(() => { setQuery(defaultValue); }, [defaultValue]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(normalized), 250);
    setActiveIndex(-1);
    return () => window.clearTimeout(timer);
  }, [normalized]);

  const suggestions = useQuery({
    queryKey: ['search-suggestions', debounced],
    queryFn: ({ signal }) => suggestProducts(debounced, 6, signal),
    enabled: focused && ready,
    // An offline search must expose its retry state instead of silently pausing forever.
    networkMode: 'always',
    staleTime: 15_000,
    gcTime: 60_000,
    retry: false,
  });
  // Previous results are never selectable while a different query debounces or fails.
  const products = ready && !suggestions.isError ? suggestions.data?.items : undefined;
  const options = useMemo(() => {
    const items = products ?? [];
    const brands = [...new Map(items.map(item => [item.brand.slug, item.brand])).values()].slice(0, 3);
    const categories = [...new Map(items.flatMap(item => item.category ? [[item.category.slug, item.category] as const] : [])).values()]
      .slice(0, 3).map(category => ({ ...category, name: categoryLabel(category, locale) ?? category.name }));
    return buildSearchOptions({ query: normalized, brands, products: items, categories, viewAllLabel: fillMessage(m.searchViewAll, { q: normalized }) });
  }, [products, normalized, locale, m.searchViewAll]);
  const active = options[activeIndex];
  const listId = `${id}-options`;
  const showPanel = focused || Boolean(mobile);
  const loading = normalized.length >= 2 && (!ready || suggestions.isPending || suggestions.isFetching);
  const close = () => { setFocused(false); setActiveIndex(-1); };

  function readHistory() {
    try { setRecent(readRecentSearches(sessionStorage.getItem(HISTORY_KEY))); } catch { setRecent([]); }
  }
  function navigate(href: string, submitted = normalized) {
    try {
      const next = rememberSearch(readRecentSearches(sessionStorage.getItem(HISTORY_KEY)), submitted);
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(next)); setRecent(next);
    } catch { /* Storage is optional. */ }
    close(); onNavigate?.(); router.push(href);
  }

  useEffect(() => {
    if (!active || !resultsPanelRef.current) return;
    const option = document.getElementById(`${id}-${active.id}`);
    if (!option) return;

    const panel = resultsPanelRef.current;
    const panelBounds = panel.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    const nextScrollTop = nextScrollTopForOptionVisibility({
      scrollTop: panel.scrollTop,
      viewportTop: panelBounds.top,
      viewportBottom: panelBounds.bottom,
      optionTop: optionBounds.top,
      optionBottom: optionBounds.bottom,
    });
    if (nextScrollTop !== panel.scrollTop) panel.scrollTop = nextScrollTop;
  }, [active, id]);
  useEffect(() => {
    if (!focused || mobile) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) setFocused(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [focused, mobile]);

  return (
    <div ref={panelRef} className={cn('relative w-full', mobile && 'flex min-h-0 flex-1 flex-col')}
      onBlur={event => { if (!mobile && !event.currentTarget.contains(event.relatedTarget)) close(); }}>
      <SearchField id={id} variant="compact" inputRef={inputRef} action={routes.products} label={label}
        placeholder={placeholder} value={query} maxLength={120} autoFocus={mobile} role="combobox" aria-autocomplete="list"
        aria-expanded={showPanel && options.length > 0} aria-controls={options.length ? listId : undefined}
        aria-activedescendant={active ? `${id}-${active.id}` : undefined}
        onFocus={() => { setFocused(true); readHistory(); }}
        onChange={event => { setQuery(event.target.value); setActiveIndex(-1); setFocused(true); }}
        onFormSubmit={event => { event.preventDefault(); if (active) navigate(active.href); else if (normalized) navigate(routes.productsSearch(normalized)); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' && !mobile) { event.preventDefault(); close(); }
          else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && options.length) {
            event.preventDefault(); setFocused(true); setActiveIndex(index => stepActiveIndex(index, options.length, event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'));
          }
        }}
        endAdornment={query ? <button type="button" aria-label={m.searchClear} onClick={() => { setQuery(''); setActiveIndex(-1); inputRef.current?.focus(); readHistory(); }}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-stone hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"><Icon name="close" size={18} /></button> : null} />

      {showPanel ? <div ref={resultsPanelRef} className={cn('overflow-y-auto overscroll-contain bg-linen text-ink', mobile
        ? 'mt-4 min-h-0 flex-1 pb-safe' : 'absolute end-0 top-full z-overlay mt-2 w-full min-w-80 max-w-[calc(100vw-2rem)] max-h-[70dvh] rounded-card shadow-elevation-2')}>
        {normalized.length < 2 ? <div className="px-4 py-4">
          <p className="m-0 text-14 text-stone">{m.searchHint}</p>
          {recent.length ? <section aria-label={m.searchRecent} className="mt-5">
            <div className="flex items-center justify-between gap-3"><h3 className="m-0 text-label font-semibold">{m.searchRecent}</h3>
              <Button variant="text" size="s" onClick={() => { try { sessionStorage.removeItem(HISTORY_KEY); } catch { /* Storage may be disabled. */ } setRecent([]); }}>{m.searchClearHistory}</Button></div>
            {recent.map(value => <button key={value} type="button" onClick={() => navigate(routes.productsSearch(value), value)}
              className="flex min-h-11 w-full items-center gap-3 text-start text-14 hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"><Icon name="search" size={16} /><bdi>{value}</bdi></button>)}
          </section> : null}
        </div> : null}
        <div role="status" aria-live="polite">
          {loading ? <div className="space-y-3 px-4 py-4"><p className="m-0 text-13 text-stone">{m.searchLoading}</p><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : null}
          {ready && suggestions.isError ? <div className="flex items-center justify-between gap-3 px-4 py-4"><p className="m-0 text-14 text-tomato-ink">{m.searchError}</p><Button variant="text" size="s" onClick={() => suggestions.refetch()}>{m.plpRetry}</Button></div> : null}
          {ready && suggestions.isSuccess && !products?.length && !loading ? <p className="m-0 px-4 py-6 text-14 text-stone">{m.searchEmpty}</p> : null}
        </div>
        {options.length ? <div id={listId} role="listbox" aria-label={label} className="py-2">
          {(['brand', 'product', 'category', 'view-all'] as const).map(kind => {
            const group = options.filter(option => option.kind === kind);
            if (!group.length) return null;
            const heading = kind === 'brand' ? m.searchBrandsGroup : kind === 'product' ? m.searchProductsGroup : kind === 'category' ? m.searchCategoriesGroup : m.searchSubmit;
            return <div key={kind} role="group" aria-label={heading}>
              {kind !== 'view-all' ? <p aria-hidden="true" className="m-0 px-4 pb-1 pt-3 text-12 font-semibold text-stone">{heading}</p> : null}
              {group.map(option => <Link key={option.id} id={`${id}-${option.id}`} href={option.href} role="option" aria-selected={active?.id === option.id}
                onMouseEnter={() => setActiveIndex(options.indexOf(option))}
                onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(option.href); } }}
                className={cn('flex min-h-11 items-center gap-3 px-4 py-2 text-14 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cobalt',
                  active?.id === option.id ? 'bg-sand/50 text-cobalt' : 'hover:bg-sand/30', kind === 'view-all' && 'mt-2 border-t border-line font-semibold text-cobalt')}>
                {option.kind === 'product' ? <ProductTile src={option.imageUrl ?? null} alt="" name={option.label} size="thumb" fit="contain" className="size-14 shrink-0" /> : null}
                <span className="min-w-0 flex-1"><bdi className={cn('block font-medium', option.kind === 'product' ? 'line-clamp-2' : 'truncate')}>{option.label}</bdi>
                  {option.kind === 'product' ? <bdi className="mt-1 block text-12 text-stone">{option.brandName}</bdi> : null}</span>
                <Icon name="arrow-forward" size={16} className="shrink-0" />
              </Link>)}
            </div>;
          })}
        </div> : null}
      </div> : null}
    </div>
  );
}
