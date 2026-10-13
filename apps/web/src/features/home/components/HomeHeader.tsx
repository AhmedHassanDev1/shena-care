import { SiteHeader } from '@/components/navigation/site-header';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { CartLink } from './CartLink';

/** Home's header: the shared SiteHeader with the storefront's real destinations. */
export function HomeHeader() {
  const m = getMessages(getLocale());
  // The wordmark already links home. Category shortcuts only appear once the row has room for them (xl).
  const links = [
    { href: routes.products, label: m.homeNavProducts },
    { href: routes.productsByCategory(mainCategorySlugs.skin), label: m.homeNavSkin, extra: true },
    { href: routes.productsByCategory(mainCategorySlugs.hair), label: m.homeNavHair, extra: true },
    { href: routes.routineBuilder, label: m.homeNavRoutines },
  ];

  return (
    <SiteHeader
      links={links}
      cart={<CartLink />}
      labels={{
        home: m.authHome,
        nav: m.homeNavLabel,
        account: m.homeNavAccount,
        searchLabel: m.searchLabel,
        searchSubmit: m.searchSubmit,
        searchPlaceholder: m.searchPlaceholder,
      }}
    />
  );
}
