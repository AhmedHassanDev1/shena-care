import { Search } from 'lucide-react';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Catalog search. A plain GET form to the products listing: `q` matches product name, brand and SKU
 * in the API (discovery.service.ts), which is all the placeholder promises. Works without JavaScript.
 */
export function SearchBar({ className }: { className?: string }) {
  const m = getMessages(getLocale());

  return (
    <form action={routes.products} method="get" role="search" className={cn('relative', className)}>
      <label htmlFor="home-search" className="sr-only">
        {m.searchLabel}
      </label>
      <input
        id="home-search"
        name="q"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={120}
        placeholder={m.searchPlaceholder}
        className="h-12 w-full rounded-md border border-input bg-card ps-4 pe-14 text-body text-foreground shadow-raised placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="submit"
        className="absolute inset-y-0 end-0 flex w-12 items-center justify-center rounded-e-md text-muted-foreground transition-colors duration-fast ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search aria-hidden="true" className="size-5" />
        <span className="sr-only">{m.searchSubmit}</span>
      </button>
    </form>
  );
}
