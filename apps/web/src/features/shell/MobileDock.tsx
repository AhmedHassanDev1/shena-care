'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CountBadge } from '@/components/ui/count-badge';
import { Icon, type IconName } from '@/components/ui/icon';
import { useCart } from '@/features/cart/hooks/useCart';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

export type DockItem = 'home' | 'routines' | 'shina' | 'cart' | 'account' | 'none';

export interface MobileDockProps {
  active?: DockItem;
}

function deriveActiveTab(pathname: string): DockItem {
  if (!pathname || pathname === '/' || pathname === '') return 'home';
  if (pathname.startsWith('/routines')) return 'routines';
  if (pathname.startsWith('/shina')) return 'shina';
  if (pathname.startsWith('/cart')) return 'cart';
  if (pathname.startsWith('/account') || pathname.startsWith('/orders')) return 'account';
  return 'none';
}

/**
 * Sahel Persistent Mobile Bottom Navigation Dock.
 * Persistent across storefront routes, with automatic route-derived active tab,
 * live cart count badge, safe-area inset compliance, and tactile transitions.
 */
export function MobileDock({ active }: MobileDockProps) {
  const pathname = usePathname() || '';
  const locale = useLocale();
  const m = useMessages();
  const { cart } = useCart();

  const currentActive = active && active !== 'none' ? active : deriveActiveTab(pathname);

  const cartCount = cart?.itemCount ?? 0;
  const cartBadge = cartCount > 0 ? formatNumber(cartCount, locale) : null;

  const items: Array<{
    id: 'home' | 'routines' | 'shina' | 'cart' | 'account';
    href: string;
    icon: IconName;
    label: string;
    badge?: string | null;
    isAssistant?: boolean;
  }> = [
    { id: 'home', href: routes.home, icon: 'home', label: m.homeNavHome },
    { id: 'routines', href: shellRoutes.routines, icon: 'routine', label: m.homeNavRoutines },
    { id: 'shina', href: shellRoutes.shina, icon: 'sparkles', label: m.footerAskShina, isAssistant: true },
    { id: 'cart', href: routes.cart, icon: 'bag', label: m.shellCart, badge: cartBadge },
    { id: 'account', href: routes.account, icon: 'user', label: m.homeNavAccount },
  ];

  return (
    <nav
      aria-label={m.homeNavLabel}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-nav pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] lg:hidden"
    >
      <div className="mx-auto flex justify-center px-3">
        <ul className="pointer-events-auto m-0 flex h-16 w-full max-w-md list-none items-center justify-around rounded-pill border border-ink/15 bg-linen/95 p-1.5 shadow-elevation-3 backdrop-blur-xl">
          {items.map((it) => {
            const isActive = it.id === currentActive;
            return (
              <li key={it.id} className="relative flex-1">
                <Link
                  href={it.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'relative flex h-13 w-full flex-col items-center justify-center gap-0.5 rounded-pill px-1 text-11 font-display font-semibold leading-tight no-underline transition-all duration-fast ease-standard',
                    isActive
                      ? 'bg-cobalt text-chalk shadow-elevation-1'
                      : 'text-stone hover:text-ink active:scale-95'
                  )}
                >
                  <div className="relative flex items-center justify-center">
                    <Icon name={it.icon} size={20} />
                    {it.badge ? (
                      <CountBadge className="absolute -top-1.5 -end-2.5 h-4 min-w-[16px] px-1 text-10.5 font-bold leading-none">
                        {it.badge}
                      </CountBadge>
                    ) : null}
                    {it.isAssistant && !isActive ? (
                      <span className="absolute -top-0.5 -end-1 size-1.5 rounded-full bg-citron ring-1 ring-ink/20" />
                    ) : null}
                  </div>
                  <span className="max-w-[62px] truncate text-center">{it.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
