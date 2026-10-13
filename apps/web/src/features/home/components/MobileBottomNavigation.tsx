'use client';

import { usePathname } from 'next/navigation';
import { BottomNav } from '@/components/navigation/bottom-nav';
import type { BottomNavItem } from '@/components/navigation/bottom-nav';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { useCartCount } from '../hooks/useCartCount';

/** The app's phone/tablet destinations on the shared `BottomNav` (hidden from desktop, where the header carries them). */
export function MobileBottomNavigation() {
  const m = useMessages();
  const pathname = usePathname();
  const cartCount = useCartCount();

  const items: BottomNavItem[] = [
    { href: routes.home, label: m.homeNavHome, icon: 'home' },
    { href: routes.products, label: m.homeNavCategories, icon: 'shelf' },
    { href: routes.routineBuilder, label: m.homeNavRoutines, icon: 'routine' },
    {
      href: routes.cart,
      label: m.homeNavCart,
      icon: 'bag',
      badge: cartCount,
      ariaLabel: cartCount ? fillMessage(m.homeCartCount, { n: cartCount }) : undefined,
    },
    { href: routes.account, label: m.homeNavAccount, icon: 'user' },
  ];

  const activeHref = items.find(({ href }) => (href === routes.home ? pathname === href : pathname.startsWith(href)))?.href;

  return <BottomNav items={items} activeHref={activeHref} label={m.homeNavLabel} />;
}
