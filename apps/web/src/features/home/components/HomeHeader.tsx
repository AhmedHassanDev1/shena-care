'use client';

import Link from 'next/link';
import { ShoppingBag, UserRound } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/hooks/useCart';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { HomeSearch } from './HomeSearch';

const iconButton =
  'relative inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-md px-2.5 text-support font-medium text-foreground transition-colors duration-fast ease-standard hover:bg-secondary';

export function HomeHeader() {
  const m = useMessages();
  const locale = useLocale();
  const { user, isLoading } = useAuth();
  const { cart } = useCart();
  const count = cart?.itemCount ?? 0;

  return (
    <header className="sticky top-0 z-chrome border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[75rem] items-center gap-2 px-4 py-2 md:gap-6 md:px-8 md:py-3">
        <BrandLogo />

        <nav aria-label={m.navigation} className="hidden items-center gap-1 lg:flex">
          <Link href={routes.products} className="rounded-md px-3 py-2 text-support font-medium text-foreground hover:bg-secondary">
            {m.navProducts}
          </Link>
          <Link href={routes.routineBuilder} className="rounded-md px-3 py-2 text-support font-medium text-foreground hover:bg-secondary">
            {m.navRoutine}
          </Link>
          <Link href="#concerns" className="rounded-md px-3 py-2 text-support font-medium text-foreground hover:bg-secondary">
            {m.navConcerns}
          </Link>
        </nav>

        <HomeSearch className="hidden max-w-md flex-1 md:block" />

        <div className="ms-auto flex items-center gap-0.5">
          <LocaleSwitch />
          {/* Account state is unknown until the session check finishes; keep the slot empty, not wrong. */}
          {isLoading ? (
            <span aria-hidden="true" className="size-11" />
          ) : (
            <Link href={user ? '/account' : routes.login} className={iconButton}>
              <UserRound aria-hidden="true" className="size-5" strokeWidth={1.75} />
              <span className="hidden md:inline">{user ? m.account : m.login}</span>
              <span className="sr-only md:hidden">{user ? m.account : m.login}</span>
            </Link>
          )}
          <Link
            href={routes.cart}
            className={iconButton}
            aria-label={count > 0 ? fillMessage(m.cartLabelWithCount, { count: formatNumber(count, locale) }) : m.cartLabel}
          >
            <ShoppingBag aria-hidden="true" className="size-5" strokeWidth={1.75} />
            {count > 0 ? (
              <span
                aria-hidden="true"
                className="absolute end-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-caption font-semibold leading-none text-primary-foreground"
              >
                {formatNumber(count, locale)}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
      <div className="px-4 pb-3 md:hidden">
        <HomeSearch />
      </div>
    </header>
  );
}
