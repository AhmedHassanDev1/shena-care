import { Search, SlidersHorizontal } from 'lucide-react';
import { routes } from '@/lib/routes';

export function HomeSearch() {
  return (
    <form className="mobile-search" action={routes.products} role="search">
      <label>
        <Search aria-hidden="true" />
        <input name="search" placeholder="Search for products, concerns, routines..." aria-label="Search the store" />
      </label>
      <button type="submit" aria-label="Open product search and filters"><SlidersHorizontal aria-hidden="true" /></button>
    </form>
  );
}
