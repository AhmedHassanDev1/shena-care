import { SearchField } from '@/components/ui/search-field';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

/**
 * Catalog search. A plain GET form to the products listing: `q` matches product name, brand and SKU
 * in the API (discovery.service.ts), which is all the placeholder promises. Works without JavaScript.
 */
export function SearchBar({ className, size }: { className?: string; size?: 's' | 'm' }) {
  const m = getMessages(getLocale());

  return (
    <SearchField
      id="home-search"
      action={routes.products}
      label={m.searchLabel}
      submitLabel={m.searchSubmit}
      placeholder={m.searchPlaceholder}
      maxLength={120}
      size={size}
      className={className}
    />
  );
}
