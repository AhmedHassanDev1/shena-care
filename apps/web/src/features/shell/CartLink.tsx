'use client';

import Link from 'next/link';
import { CountBadge } from '@/components/ui/count-badge';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { useCart } from '@/features/cart/hooks/useCart';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * The cart lives in the header, with its count (handoff §Floating nav: "the cart is an icon with a count in the header,
 * not a nav item"). `pill` is the desktop night pill «السلة» (Main, CartD); `icon` is the phone header bag.
 */
export function CartLink({ variant }: { variant: 'pill' | 'icon' }) {
  const m = useMessages();
  const locale = useLocale();
  const { cart } = useCart();
  const count = cart?.itemCount ?? 0;
  const shown = count > 0 ? formatNumber(count, locale) : null;
  const label = shown ? fillMessage(m.shellCartCount, { n: shown }) : m.shellCart;

  if (variant === 'pill') {
    return (
      <Link
        href={routes.cart}
        aria-label={label}
        className="inline-flex h-control-m items-center gap-2 rounded-pill bg-ink ps-4.5 pe-3 text-16 font-display font-semibold text-chalk shadow-elevation-1 no-underline transition-all duration-fast ease-standard hover:bg-cobalt hover:shadow-elevation-2"
      >
        <Icon name="bag" size={20} />
        <span>{m.shellCart}</span>
        {shown ? <CountBadge>{shown}</CountBadge> : <span className="w-1.5" aria-hidden="true" />}
      </Link>
    );
  }

  return (
    <Link href={routes.cart} aria-label={label} className={cn(iconButtonVariants())}>
      <Icon name="bag" size={24} />
      {shown ? <CountBadge className="absolute -top-0.5 -end-0.5">{shown}</CountBadge> : null}
    </Link>
  );
}
