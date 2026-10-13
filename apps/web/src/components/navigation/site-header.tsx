import * as React from 'react';
import Link from 'next/link';

import { PageContainer } from '@/components/layout/page-container';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { SearchField } from '@/components/ui/search-field';
import { routes } from '@/lib/routes';
import { HeaderNav, type HeaderNavLink } from './header-nav';
import { WordmarkLink } from './wordmark-link';

export interface SiteHeaderProps {
  links: HeaderNavLink[];
  labels: {
    home: string;
    nav: string;
    account: string;
    searchLabel: string;
    searchSubmit: string;
    searchPlaceholder: string;
  };
  /** The cart control (it owns the live count, so it is injected). */
  cart: React.ReactNode;
}

/**
 * The storefront header, composed independently for each form factor (it is not one row that shrinks):
 *
 * - Phone / tablet: brand + language + cart on the first row, a full-width 52px search under it (the main
 *   action on every entry screen). Account lives in the bottom navigation. Scrolls away with the page.
 * - Desktop (lg+): sticky bar with the brand, the real destinations with an active state, a prominent search,
 *   and language / account / cart actions.
 */
export function SiteHeader({ links, labels, cart }: SiteHeaderProps) {
  // Two compositions are rendered (one is display:none per breakpoint), so each needs its own ids.
  const search = (id: string, size: 's' | 'm') => (
    <SearchField
      id={id}
      size={size}
      action={routes.products}
      label={labels.searchLabel}
      submitLabel={labels.searchSubmit}
      placeholder={labels.searchPlaceholder}
      maxLength={120}
    />
  );

  return (
    <header className="bg-gradient-to-b from-rose-wash to-background lg:sticky lg:top-0 lg:z-nav lg:border-b lg:border-border lg:bg-background/95 lg:backdrop-blur">
      {/* Phone / tablet */}
      <PageContainer className="flex flex-col gap-3 pb-3 pt-2 lg:hidden">
        <div className="flex items-center justify-between gap-2">
          {/* Under 360px the Latin sub-name gives way so language + cart still fit (the link's name is unchanged). */}
          <WordmarkLink label={labels.home} size="m" className="max-[359px]:[&_[data-lat]]:hidden" />
          <div className="flex items-center gap-1">
            <LocaleSwitch />
            {cart}
          </div>
        </div>
        {search('site-search-mobile', 'm')}
      </PageContainer>

      {/* Desktop */}
      <PageContainer className="hidden items-center gap-6 py-3 lg:flex">
        <WordmarkLink label={labels.home} size="m" className="-ms-1" />
        <HeaderNav links={links} label={labels.nav} />
        <div className="ms-auto w-full max-w-[26rem] flex-1">{search('site-search-desktop', 's')}</div>
        <div className="flex items-center gap-1">
          <LocaleSwitch />
          <Link href={routes.account} aria-label={labels.account} className={iconButtonVariants()}>
            <Icon name="user" />
          </Link>
          {cart}
        </div>
      </PageContainer>
    </header>
  );
}
