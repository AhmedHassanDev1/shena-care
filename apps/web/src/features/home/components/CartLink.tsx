'use client';

import Link from 'next/link';
import { CountBadge } from '@/components/ui/count-badge';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
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
      className={cn(iconButtonVariants(), className)}
    >
      <Icon name="bag" />
      <CountBadge count={count} className="absolute end-0 top-0.5" />
    </Link>
  );
}
