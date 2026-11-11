'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/components/ui/icon';
import { SearchField } from '@/components/ui/search-field';
import { apiClient } from '@/lib/api-client';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { suggestProducts, type ProductSuggestion } from '../api/discovery';
import {
  buildSearchOptions,
  matchActiveBrands,
  normalizeSearchQuery,
  stepActiveIndex,
  type SearchBrandCandidate,
} from '../lib/search-helpers';

interface BrandApiRecord extends SearchBrandCandidate {
  id?: string;
}

interface ProductSearchProps {
  id: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
}

const DEBOUNCE_MS = 250;
const MAX_CACHE_ENTRIES = 25;

function SearchErrorBanner({
  errorText,
  retryLabel,
  onRetry,
  className,
}: {
  errorText: string;
  retryLabel: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-4 py-3.5', className)} role="status">
      <span className="text-13.5 font-medium text-tomato-ink">{errorText}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill border border-line-2/30 bg-chalk px-3.5 text-13 font-semibold text-ink transition-colors duration-fast hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
      >
        <Icon name="retry" size={14} />
        <span>{retryLabel}</span>
      </button>
    </div>
  );
}

/**
 * Header product and brand search backed by `/products/suggestions` and `/brands`.
 * Supports Arabic/English input, debounced autocomplete, keyboard navigation, and
 * explicit loading, empty, and recoverable error states.
 */
export function ProductSearch({ id, label, placeholder, defaultValue = '' }: ProductSearchProps) {
  const m = useMessages();
  const router = useRouter();

  const [query, setQuery] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retryNonce, setRetryNonce] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const cacheRef = useRef<Map<string, ProductSuggestion[]>>(new Map());
  const prevRetryRef = useRef(0);

  useEffect(() => {
    setQuery(defaultValue);
  }, [defaultValue]);

  const normalizedQuery = useMemo(() => normalizeSearchQuery(query), [query]);

  const { data: brandsData } = useQuery({
    queryKey: ['brands', 'public'],
    queryFn: async () => {
      try {
        const res = await apiClient.get<BrandApiRecord[]>('/brands');
        return Array.isArray(res) && res.length > 0 ? res : null;
      } catch {
        return null;
      }
    },
    enabled: focused || normalizedQuery.length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!focused || normalizedQuery.length < 2) {
      if (normalizedQuery.length < 2) {
        setProducts([]);
        setStatus('idle');
      }
      return;
    }

    const isRetry = retryNonce !== prevRetryRef.current;
    prevRetryRef.current = retryNonce;
    if (isRetry) {
      cacheRef.current.delete(normalizedQuery);
    }

    const cached = cacheRef.current.get(normalizedQuery);
    if (cached) {
      setProducts(cached);
      setStatus('loaded');
      return;
    }

    const controller = new AbortController();
    setStatus('loading');

    const timer = window.setTimeout(() => {
      suggestProducts(normalizedQuery, 6, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (cacheRef.current.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = cacheRef.current.keys().next().value;
            if (oldestKey !== undefined) cacheRef.current.delete(oldestKey);
          }
          cacheRef.current.set(normalizedQuery, result.items);
          setProducts(result.items);
          setStatus('loaded');
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setProducts([]);
          setStatus('error');
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, focused, retryNonce]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [normalizedQuery]);

  const matchedBrands = useMemo(
    () => matchActiveBrands(brandsData, normalizedQuery, 3),
    [brandsData, normalizedQuery],
  );

  const viewAllLabel = useMemo(
    () => (normalizedQuery.length >= 2 ? fillMessage(m.searchViewAll, { q: normalizedQuery }) : ''),
    [m.searchViewAll, normalizedQuery],
  );

  const options = useMemo(
    () =>
      buildSearchOptions({
        query: normalizedQuery,
        brands: matchedBrands,
        products,
        viewAllLabel,
      }),
    [normalizedQuery, matchedBrands, products, viewAllLabel],
  );

  const clampedIndex = activeIndex >= 0 && activeIndex < options.length ? activeIndex : -1;
  const activeOption = clampedIndex >= 0 ? options[clampedIndex] ?? null : null;

  const listboxId = `${id}-listbox`;
  const showPopup = focused && normalizedQuery.length >= 2;
  const hasResults = options.length > 0;
  const brandOptions = options.filter((o) => o.kind === 'brand');
  const productOptions = options.filter((o) => o.kind === 'product');
  const viewAllOption = options.find((o) => o.kind === 'view-all') ?? null;

  const closePopup = () => {
    setFocused(false);
    setActiveIndex(-1);
  };

  const handleClear = () => {
    setQuery('');
    setProducts([]);
    setStatus('idle');
    setActiveIndex(-1);
    setFocused(true);
    inputRef.current?.focus();
  };

  const handleRetry = () => {
    setRetryNonce((n) => n + 1);
    inputRef.current?.focus();
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (showPopup && activeOption) {
      closePopup();
      router.push(activeOption.href);
      return;
    }
    closePopup();
    router.push(normalizedQuery ? routes.productsSearch(normalizedQuery) : routes.products);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (showPopup) {
        event.preventDefault();
        closePopup();
      } else if (query.length > 0) {
        event.preventDefault();
        handleClear();
      }
      return;
    }

    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      if (!normalizedQuery || normalizedQuery.length < 2) return;
      if (!focused) setFocused(true);
      if (options.length === 0) return;
      event.preventDefault();
      setActiveIndex((prev) => stepActiveIndex(prev, options.length, event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'));
    }
  };

  const optionIndexById = new Map(options.map((opt, idx) => [opt.id, idx]));

  return (
    <div
      className="relative w-full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          closePopup();
        }
      }}
    >
      <SearchField
        id={id}
        variant="compact"
        inputRef={inputRef}
        action={routes.products}
        onFormSubmit={handleSubmit}
        label={label}
        placeholder={placeholder}
        maxLength={120}
        value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showPopup}
        aria-controls={listboxId}
        aria-activedescendant={activeOption ? `${id}-${activeOption.id}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setFocused(true);
        }}
        onFocus={() => setFocused(true)}
        onKeyDown={handleKeyDown}
        endAdornment={
          query.length > 0 ? (
            <button
              type="button"
              aria-label={m.searchClear}
              onClick={handleClear}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-stone transition-colors duration-fast ease-standard hover:bg-sand/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
            >
              <Icon name="close" size={16} />
            </button>
          ) : null
        }
      />

      {showPopup ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute inset-x-0 top-full z-overlay mt-2 max-h-96 overflow-y-auto rounded-card border border-line bg-linen shadow-elevation-2 font-display"
        >
          {status === 'loading' && !hasResults ? (
            <div className="space-y-2 px-4 py-3" aria-live="polite">
              <p className="m-0 text-12.5 font-medium text-stone">{m.searchLoading}</p>
              <div className="h-9 rounded-input bg-sand/50 animate-breathe" />
              <div className="h-9 rounded-input bg-sand/50 animate-breathe" />
              <div className="h-9 rounded-input bg-sand/40 animate-breathe" />
            </div>
          ) : null}

          {status === 'error' && !hasResults ? (
            <SearchErrorBanner errorText={m.searchError} retryLabel={m.plpRetry} onRetry={handleRetry} />
          ) : null}

          {status === 'loaded' && !hasResults ? (
            <div className="px-4 py-4 text-center" role="status">
              <p className="m-0 text-14 font-medium text-stone">{m.searchEmpty}</p>
            </div>
          ) : null}

          {hasResults ? (
            <div className={cn('py-1.5 transition-opacity duration-fast', status === 'loading' && 'opacity-70')}>
              {brandOptions.length > 0 ? (
                <div>
                  <div className="px-4 pb-1 pt-2 text-11.5 font-semibold tracking-wide text-stone">
                    {m.searchBrandsGroup}
                  </div>
                  {brandOptions.map((item) => {
                    const idx = optionIndexById.get(item.id) ?? -1;
                    const isActive = idx === clampedIndex;
                    return (
                      <Link
                        key={item.id}
                        id={`${id}-${item.id}`}
                        role="option"
                        aria-selected={isActive}
                        href={item.href}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={closePopup}
                        className={cn(
                          'flex min-h-11 items-center justify-between gap-3 px-4 text-14.5 font-medium text-ink no-underline transition-colors duration-fast',
                          isActive ? 'bg-chalk text-cobalt' : 'hover:bg-chalk/80 hover:text-cobalt',
                        )}
                      >
                        <span className="truncate font-serif italic text-15">
                          <bdi>{item.label}</bdi>
                        </span>
                        <Icon name="chevron-forward" size={16} className="shrink-0 text-stone" />
                      </Link>
                    );
                  })}
                </div>
              ) : null}

              {productOptions.length > 0 ? (
                <div className={brandOptions.length > 0 ? 'mt-1 border-t border-line/70 pt-1' : undefined}>
                  <div className="px-4 pb-1 pt-2 text-11.5 font-semibold tracking-wide text-stone">
                    {m.searchProductsGroup}
                  </div>
                  {productOptions.map((item) => {
                    if (item.kind !== 'product') return null;
                    const idx = optionIndexById.get(item.id) ?? -1;
                    const isActive = idx === clampedIndex;
                    return (
                      <Link
                        key={item.id}
                        id={`${id}-${item.id}`}
                        role="option"
                        aria-selected={isActive}
                        href={item.href}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={closePopup}
                        className={cn(
                          'flex min-h-11 items-center justify-between gap-3 px-4 py-1.5 text-14.5 text-ink no-underline transition-colors duration-fast',
                          isActive ? 'bg-chalk text-cobalt' : 'hover:bg-chalk/80',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          <bdi>{item.label}</bdi>
                        </span>
                        <span className="shrink-0 font-serif italic text-13 text-stone">
                          <bdi>{item.brandName}</bdi>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : status === 'loading' && brandOptions.length > 0 ? (
                <div className="border-t border-line/70 px-4 py-2.5">
                  <p className="m-0 text-12.5 text-stone">{m.searchLoading}</p>
                </div>
              ) : status === 'error' && brandOptions.length > 0 ? (
                <SearchErrorBanner
                  errorText={m.searchError}
                  retryLabel={m.plpRetry}
                  onRetry={handleRetry}
                  className="mt-1 border-t border-line/70"
                />
              ) : null}

              {viewAllOption ? (
                <div className="mt-1 border-t border-line pt-1">
                  <Link
                    id={`${id}-${viewAllOption.id}`}
                    role="option"
                    aria-selected={optionIndexById.get(viewAllOption.id) === clampedIndex}
                    href={viewAllOption.href}
                    onMouseEnter={() => setActiveIndex(optionIndexById.get(viewAllOption.id) ?? -1)}
                    onClick={closePopup}
                    className={cn(
                      'flex min-h-11 items-center justify-between gap-2 px-4 text-13.5 font-semibold text-cobalt no-underline transition-colors duration-fast',
                      optionIndexById.get(viewAllOption.id) === clampedIndex
                        ? 'bg-chalk'
                        : 'hover:bg-chalk/80',
                    )}
                  >
                    <span className="truncate">{viewAllOption.label}</span>
                    <Icon name="arrow-forward" size={16} className="shrink-0" />
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
