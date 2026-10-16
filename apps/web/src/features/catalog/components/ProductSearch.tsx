'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SearchField } from '@/components/ui/search-field';
import { routes } from '@/lib/routes';
import { suggestProducts, type ProductSuggestion } from '../api/discovery';

interface ProductSearchProps {
  id: string;
  size: 's' | 'm';
  label: string;
  submitLabel: string;
  placeholder: string;
}

/** Full search remains a normal GET form; suggestions are an optional progressive enhancement. */
export function ProductSearch({ id, size, label, submitLabel, placeholder }: ProductSearchProps) {
  const [query, setQuery] = useState('');
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
      <SearchField id={id} size={size} action={routes.products} label={label}
        submitLabel={submitLabel} placeholder={placeholder} maxLength={120}
        value={query} onChange={event => { setQuery(event.target.value); setSuggestions([]); setFocused(true); }}
        onFocus={() => setFocused(true)} onKeyDown={event => { if (event.key === 'Escape') setFocused(false); }} />
      {show ? (
        <ul aria-label={label} className="absolute inset-x-0 top-full z-50 mt-1 border border-border bg-card shadow-sheet">
          {suggestions.map(item => (
            <li key={item.id}>
              <Link href={routes.product(item.slug)} className="block px-4 py-3 text-body-s text-foreground hover:bg-muted focus-visible:bg-muted"
                onClick={() => setFocused(false)}>
                <bdi>{item.name}</bdi>
                <span className="ms-2 text-muted-foreground"><bdi>{item.brand.name}</bdi></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
