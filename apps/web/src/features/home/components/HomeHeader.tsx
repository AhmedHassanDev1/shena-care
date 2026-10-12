import Link from 'next/link';
import { User } from 'lucide-react';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { CartLink } from './CartLink';
import { SearchBar } from './SearchBar';
import { Wordmark } from './Wordmark';

/**
 * Mobile: wordmark, language switch and the search field — cart and account live in the bottom
 * navigation. Desktop (lg+): wordmark, the routes that exist, search, and cart/account actions.
 */
export function HomeHeader() {
  const m = getMessages(getLocale());
  // The wordmark already links home. Category shortcuts only appear once the row has room for them (xl).
  const links = [
    { href: routes.products, label: m.homeNavProducts, extra: false },
    { href: routes.productsByCategory(mainCategorySlugs.skin), label: m.homeNavSkin, extra: true },
    { href: routes.productsByCategory(mainCategorySlugs.hair), label: m.homeNavHair, extra: true },
    { href: routes.routineBuilder, label: m.homeNavRoutines, extra: false },
  ];

  return (
    <header className="bg-background lg:sticky lg:top-0 lg:z-chrome lg:border-b lg:border-border">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 pt-2 sm:px-6 lg:flex-nowrap lg:px-8 lg:py-3">
        <Wordmark label={m.authHome} className="me-auto lg:me-0" />

        <nav aria-label={m.homeNavLabel} className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-2 text-support font-medium text-foreground transition-colors duration-fast ease-standard hover:bg-secondary',
                link.extra && 'hidden xl:block',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <SearchBar className="order-last w-full lg:order-none lg:ms-auto lg:w-48 xl:w-72" />

        <div className="flex items-center gap-1">
          <LocaleSwitch />
          <div className="hidden items-center gap-1 lg:flex">
            <CartLink />
            <Link
              href={routes.account}
              aria-label={m.homeNavAccount}
              className="flex size-11 items-center justify-center rounded-md text-foreground transition-colors duration-fast ease-standard hover:bg-secondary"
            >
              <User aria-hidden="true" className="size-[22px]" />
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
