import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

/**
 * Routes that exist (FloatingNav, footer) but have no V18 board yet: account, routines, Shina. A calm SAHEL notice with
 * one way back, never a dead end. `data-ui-status` keeps the route contract checked by scripts/check-ui-reset.mjs.
 */
export function RedesignPlaceholder({ route }: { route: string }) {
  const m = getMessages(getLocale());
  return (
    <section
      data-ui-status="redesign-pending"
      data-route={route}
      aria-labelledby="placeholder-title"
      className="mx-auto flex min-h-[60dvh] max-w-narrow flex-col items-start justify-center gap-4 px-4 py-16"
    >
      <h1 id="placeholder-title" className="m-0 text-display-1 text-ink font-display font-bold">
        {m.placeholderTitle}
      </h1>
      <p className="m-0 text-16 leading-26 text-stone font-display">{m.placeholderBody}</p>
      <Link href={routes.home} className={buttonVariants({ variant: 'ink', size: 'm' })}>
        {m.placeholderHome}
      </Link>
    </section>
  );
}
