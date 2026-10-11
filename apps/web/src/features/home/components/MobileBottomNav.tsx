'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, LayoutGrid, ShoppingBag, UserRound, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/hooks/useCart';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

type NavItem = { label: string; href: string; icon: LucideIcon; badge?: number };

export function MobileBottomNav() {
  const pathname = usePathname();
  const m = useMessages();
  const locale = useLocale();
  const { user } = useAuth();
  const { cart } = useCart();
  const count = cart?.itemCount ?? 0;

  const items: NavItem[] = [
    { label: m.navHome, href: routes.home, icon: Home },
    { label: m.navProducts, href: routes.products, icon: LayoutGrid },
    { label: m.cartLabel, href: routes.cart, icon: ShoppingBag, badge: count },
    { label: user ? m.account : m.login, href: user ? '/account' : routes.login, icon: UserRound },
  ];

  return (
    <nav
      aria-label={m.navPrimary}
      className="fixed inset-x-0 bottom-0 z-chrome grid grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map(({ label, href, icon: Icon, badge }) => {
        const active = href === routes.home ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-16 flex-col items-center justify-center gap-1 text-caption font-medium',
              active ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <span className="relative">
              <Icon aria-hidden="true" className="size-[22px]" strokeWidth={active ? 2.25 : 1.75} />
              {badge ? (
                <span className="absolute -end-2.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-caption font-semibold leading-none text-primary-foreground">
                  {formatNumber(badge, locale)}
                </span>
              ) : null}
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
