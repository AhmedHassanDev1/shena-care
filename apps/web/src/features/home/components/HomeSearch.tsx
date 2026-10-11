'use client';

import { Search } from 'lucide-react';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/** Store search. Submits to the product listing, as before. */
export function HomeSearch({ className }: { className?: string }) {
  const m = useMessages();
  return (
    <form action={routes.products} role="search" className={cn('relative', className)}>
      <input
        name="search"
        type="search"
        placeholder={m.searchPlaceholder}
        aria-label={m.searchLabel}
        className="h-11 w-full rounded-md border border-input bg-card pe-12 ps-4 text-support text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <button
        type="submit"
        aria-label={m.searchSubmit}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      >
        <Search aria-hidden="true" className="size-[18px]" />
      </button>
    </form>
  );
}
