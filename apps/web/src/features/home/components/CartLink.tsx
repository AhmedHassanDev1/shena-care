'use client';

import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useCartCount } from '../hooks/useCartCount';

/** Cart link with a live count badge (desktop header). */
export function CartLink({ className }: { className?: string }) {
  const m = useMessages();
  const count = useCartCount();

  return (
    <Link
      href={routes.cart}
      aria-label={count > 0 ? fillMessage(m.homeCartCount, { n: count }) : m.homeNavCart}
      className={cn(
        'relative flex size-11 items-center justify-center rounded-md text-foreground transition-colors duration-fast ease-standard hover:bg-secondary',
        className,
      )}
    >
      <ShoppingBag aria-hidden="true" className="size-[22px]" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute end-1 top-1 flex min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-semibold leading-[1.125rem] text-primary-foreground tabular-nums"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
