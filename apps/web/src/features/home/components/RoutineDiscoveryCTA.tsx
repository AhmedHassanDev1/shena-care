import Link from 'next/link';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

/** Entry to the routine builder journey. No promises about outcomes: it asks questions, nothing more. */
export function RoutineDiscoveryCTA() {
  const m = getMessages(getLocale());

  return (
    <section
      aria-labelledby="home-cta"
      className="flex flex-col gap-4 rounded-lg border border-border bg-secondary p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-8"
    >
      <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-card text-primary shadow-raised lg:size-16">
        <ClipboardCheck aria-hidden="true" className="size-7" />
      </span>
      <div className="flex-1">
        <h2 id="home-cta" className="text-h3 text-foreground lg:text-h2">
          {m.ctaTitle}
        </h2>
        <p className="mt-1 text-support text-secondary-foreground lg:text-body">{m.ctaDescription}</p>
      </div>
      <Link href={routes.routineBuilder} className={buttonVariants({ size: 'lg' })}>
        {m.ctaButton}
        <ArrowLeft aria-hidden="true" className="ltr:rotate-180" />
      </Link>
    </section>
  );
}
