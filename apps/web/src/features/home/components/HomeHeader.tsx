import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { WordmarkLink } from '@/components/navigation/wordmark-link';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { CartLink } from './CartLink';
import { SearchBar } from './SearchBar';

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
    <header className="bg-background lg:sticky lg:top-0 lg:z-nav lg:border-b lg:border-border">
      <PageContainer className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-3 pt-2 lg:flex-nowrap lg:py-3">
        <WordmarkLink label={m.authHome} size="responsive" className="me-auto lg:me-0" />

        <nav aria-label={m.homeNavLabel} className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'whitespace-nowrap rounded-pill px-4 py-2 text-label text-ink-soft transition-colors duration-quick ease-out hover:bg-sand hover:text-foreground',
                link.extra && 'hidden xl:block',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <SearchBar size="m" className="order-last w-full lg:order-none lg:ms-auto lg:w-52 xl:w-72" />

        <div className="flex items-center gap-1">
          <LocaleSwitch />
          <div className="hidden items-center gap-1 lg:flex">
            <CartLink />
            <Link href={routes.account} aria-label={m.homeNavAccount} className={iconButtonVariants()}>
              <Icon name="user" />
            </Link>
          </div>
        </div>
      </PageContainer>
    </header>
  );
}
