'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, Home, LayoutGrid, ShoppingBag, UserRound, LucideIcon } from 'lucide-react';
import { routes } from '@/lib/routes';
import { useCart } from '@/features/cart/hooks/useCart';

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  hasBadge?: boolean;
};

const items: NavItem[] = [
  { label: 'الرئيسية', href: routes.home, icon: Home },
  { label: 'التصنيفات', href: '/products', icon: LayoutGrid },
  { label: 'السلة', href: routes.cart, icon: ShoppingBag, hasBadge: true },
  { label: 'حسابي', href: routes.login, icon: UserRound },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { cart } = useCart();

  return (
    <nav className="mobile-bottom-nav md:hidden" aria-label="Primary mobile navigation">
      {items.map(({ label, href, icon: Icon, hasBadge }) => {
        const active = pathname === href;
        return (
          <Link key={label} href={href} className={active ? 'is-active' : undefined}>
            <span className="relative">
              <Icon aria-hidden="true" />
              {hasBadge && cart && cart.itemCount > 0 ? (
                <span className="absolute -top-1 -right-1 bg-[#E57A73] text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">
                  {cart.itemCount}
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
