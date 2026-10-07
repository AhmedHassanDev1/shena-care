'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, Home, LayoutGrid, ShoppingBag, UserRound } from 'lucide-react';
import { routes } from '@/lib/routes';

const items = [
  { label: 'Home', href: routes.home, icon: Home },
  { label: 'Routines', href: routes.routineBuilder, icon: LayoutGrid },
  { label: 'Wishlist', href: '/products?wishlist=true', icon: Heart, badge: 2 },
  { label: 'Orders', href: '/orders', icon: ShoppingBag },
  { label: 'Profile', href: routes.login, icon: UserRound },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="mobile-bottom-nav md:hidden" aria-label="Primary mobile navigation">
      {items.map(({ label, href, icon: Icon, badge }) => {
        const active = pathname === href;
        return (
          <Link key={label} href={href} className={active ? 'is-active' : undefined}>
            <span className="relative">
              <Icon aria-hidden="true" />
              {badge ? <span className="nav-badge">{badge}</span> : null}
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
