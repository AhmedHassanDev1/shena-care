'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, LayoutGrid, ListChecks, ShoppingBag, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useCartCount } from '../hooks/useCartCount';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

/**
 * Persistent phone navigation. The first item sits at the reading start, so in RTL Home is on the far
 * right. Hidden from lg up, where the header carries the same destinations.
 */
export function MobileBottomNavigation() {
  const m = useMessages();
  const pathname = usePathname();
  const cartCount = useCartCount();

  const items: NavItem[] = [
    { href: routes.home, label: m.homeNavHome, icon: Home },
    { href: routes.products, label: m.homeNavCategories, icon: LayoutGrid },
    { href: routes.routineBuilder, label: m.homeNavRoutines, icon: ListChecks },
    { href: routes.cart, label: m.homeNavCart, icon: ShoppingBag, badge: cartCount },
    { href: routes.account, label: m.homeNavAccount, icon: User },
  ];

  const isActive = (href: string) => (href === routes.home ? pathname === href : pathname.startsWith(href));

  return (
    <nav
      aria-label={m.homeNavLabel}
      className="fixed inset-x-0 bottom-0 z-chrome border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map(({ href, label, icon: Icon, badge }) => {
          const active = isActive(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                aria-label={badge ? fillMessage(m.homeCartCount, { n: badge }) : undefined}
                className={cn(
                  'relative flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] font-medium transition-colors duration-fast ease-standard focus-visible:outline-offset-[-3px]',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="relative">
                  <Icon aria-hidden="true" className="size-6" strokeWidth={active ? 2.4 : 1.8} />
                  {badge ? (
                    <span
                      aria-hidden="true"
                      className="absolute -end-2 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[0.625rem] font-semibold leading-4 text-primary-foreground tabular-nums"
                    >
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : null}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
