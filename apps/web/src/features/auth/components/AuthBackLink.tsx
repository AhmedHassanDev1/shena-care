'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes, shellRoutes } from '@/lib/routes';

/**
 * Contextual back control (AuthStates §7, Addendum §Back navigation by entry point).
 * Renders a circular white pill on mobile matching approved SAHEL design, and text link on desktop.
 */
function BackControl({ variant }: { variant: 'phone' | 'desktop' }) {
  const m = useMessages();
  const router = useRouter();
  const returnTo = useSearchParams().get('returnTo') ?? '';
  const task = returnTo.startsWith(routes.checkout)
    ? { href: routes.cart, label: m.backToCart, short: m.shellCart }
    : returnTo.startsWith('/routine') || returnTo.startsWith(shellRoutes.routines)
      ? { href: returnTo, label: m.backToRoutine, short: m.authRoutineShort }
      : null;

  const leave = () => {
    if (window.history.length > 1) router.back();
    else router.replace(routes.home);
  };

  if (task) {
    return variant === 'desktop' ? (
      <Link href={task.href} className="text-link gap-1.5 no-underline hover:text-cobalt">
        <Icon name="chevron-back" size={18} strokeWidth={2} />
        {task.label}
      </Link>
    ) : (
      <Link
        href={task.href}
        aria-label={task.label}
        className="inline-flex size-10 items-center justify-center rounded-full bg-white shadow-elevation-1 text-ink hover:bg-linen transition-colors border border-line-2/20 no-underline"
      >
        <Icon name="chevron-back" size={20} strokeWidth={2} />
      </Link>
    );
  }

  return variant === 'desktop' ? (
    <button type="button" onClick={leave} className="text-link gap-1.5 bg-transparent border-0 cursor-pointer hover:text-cobalt">
      <Icon name="chevron-back" size={18} strokeWidth={2} />
      {m.back}
    </button>
  ) : (
    <button
      type="button"
      onClick={leave}
      aria-label={m.back}
      className="inline-flex size-10 items-center justify-center rounded-full bg-white shadow-elevation-1 text-ink hover:bg-linen transition-colors border border-line-2/20 cursor-pointer"
    >
      <Icon name="chevron-back" size={20} strokeWidth={2} />
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
