'use client';

import Link from 'next/link';
import { CountBadge } from '@/components/ui/count-badge';
import { Icon } from '@/components/ui/icon';
import { useCart } from '@/features/cart/hooks/useCart';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';

/**
 * Minimal shopping-bag control connected to the live cart item count.
 * Preserves the accessible count announcement and route to `/cart`.
 */
export function CartLink() {
  const m = useMessages();
  const locale = useLocale();
  const { cart } = useCart();

  const count = cart?.itemCount ?? 0;
  const shown = count > 0 ? formatNumber(count, locale) : null;
  const label = shown ? fillMessage(m.shellCartCount, { n: shown }) : m.shellCart;

  return (
    <Link
      href={routes.cart}
      aria-label={label}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink no-underline transition-colors duration-fast ease-standard hover:bg-sand/50 hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
    >
      <Icon name="bag" size={22} />
      {shown ? <CountBadge className="absolute top-0.5 end-0.5">{shown}</CountBadge> : null}
    </Link>
  );
}
