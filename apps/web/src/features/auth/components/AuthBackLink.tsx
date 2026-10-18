'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Contextual back control (AuthStates §٧, Addendum §Back navigation by entry point). The entry point is the sign-in's
 * `returnTo`, so it survives a refresh:
 *  - from «إتمام الطلب» (returnTo /checkout): desktop «ارجع للسلة», phone chevron + «السلة» → the cart, unchanged;
 *  - otherwise (normal sign-in): desktop «رجوع», phone ✕ «قفل، ارجع للصفحة اللي كنت فيها» → previous page, Home if none.
 * On the code step it still exits sign-in; «غيّر الرقم» inside the form goes back to the phone step.
 */
function BackControl({ variant }: { variant: 'phone' | 'desktop' }) {
  const m = useMessages();
  const router = useRouter();
  const returnTo = useSearchParams().get('returnTo') ?? '';
  const fromCheckout = returnTo.startsWith(routes.checkout);

  if (fromCheckout) {
    return variant === 'desktop' ? (
      <Link href={routes.cart} className="text-link gap-1.5">
        <Icon name="chevron-back" size={18} strokeWidth={1.9} />
        {m.backToCart}
      </Link>
    ) : (
      <Link
        href={routes.cart}
        aria-label={m.backToCart}
        className="inline-flex min-h-control-s items-center gap-0.5 pe-2.5 text-15 font-semibold text-night no-underline"
      >
        <Icon name="chevron-back" size={22} strokeWidth={1.9} />
        {m.shellCart}
      </Link>
    );
  }

  const leave = () => {
    if (window.history.length > 1) router.back();
    else router.replace(routes.home);
  };
  return variant === 'desktop' ? (
    <button type="button" onClick={leave} className="text-link gap-1.5 bg-transparent">
      <Icon name="chevron-back" size={18} strokeWidth={1.9} />
      {m.back}
    </button>
  ) : (
    <button type="button" onClick={leave} aria-label={m.closeBack} className={cn(iconButtonVariants())}>
      <Icon name="close" size={22} />
    </button>
  );
}

export function AuthBackLink({ variant }: { variant: 'phone' | 'desktop' }) {
  return (
    <Suspense fallback={null}>
      <BackControl variant={variant} />
    </Suspense>
  );
}
