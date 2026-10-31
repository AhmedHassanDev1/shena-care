'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SearchField } from '@/components/ui/search-field';
import { useLocale } from '@/lib/i18n/LocaleProvider';
import { Icon } from '@/components/ui/icon';
import { routes, shellRoutes } from '@/lib/routes';
import { suggestProducts, type ProductSuggestion } from '../api/discovery';

interface ProductSearchProps {
  id: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
}

/** Full search remains a normal GET form; suggestions are an optional progressive enhancement. */
export function ProductSearch({ id, label, placeholder, defaultValue = '' }: ProductSearchProps) {
  const locale = useLocale();
  const [query, setQuery] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!focused || q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      suggestProducts(q, 8, controller.signal)
        .then(result => setSuggestions(result.items))
        .catch(() => { if (!controller.signal.aborted) setSuggestions([]); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, focused]);

  const show = focused && query.trim().length >= 2 && suggestions.length > 0;
  return (
    <div className="relative" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
      <SearchField
        id={id}
        action={routes.products}
        label={label}
        placeholder={placeholder}
        maxLength={120}
        value={query}
        onChange={event => { setQuery(event.target.value); setSuggestions([]); setFocused(true); }}
        onFocus={() => setFocused(true)}
        onKeyDown={event => { if (event.key === 'Escape') setFocused(false); }}
      />
      {show ? (
        <ul aria-label={label} className="absolute inset-x-0 top-full z-overlay mt-2 overflow-hidden rounded-card bg-linen py-1.5 border border-ink/14 shadow-e2 font-display">
          {suggestions.map(item => (
            <li key={item.id}>
              <Link
                href={routes.product(item.slug)}
                className="flex min-h-control-s items-center px-4 text-15 text-ink no-underline hover:bg-chalk focus-visible:bg-chalk transition-colors"
                onClick={() => setFocused(false)}
              >
                <bdi className="font-medium">{item.name}</bdi>
                <span className="ms-2 font-serif italic text-14 text-stone"><bdi>{item.brand.name}</bdi></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
