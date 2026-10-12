import Link from 'next/link';
import { ArrowLeft, Layers } from 'lucide-react';
import type { Locale } from '@/lib/i18n/messages';
import { formatStepCount } from '../lib/routines';
import type { RoutineSummary } from '../lib/routines';

/** A multi-step routine: a tinted, stacked-layers surface that reads differently from a product card. */
export function RoutineCard({
  routine,
  ctaLabel,
  locale,
}: {
  routine: RoutineSummary;
  ctaLabel: string;
  locale: Locale;
}) {
  return (
    <article className="relative flex w-full flex-col gap-3 rounded-md border border-border bg-secondary p-5">
      <span className="flex size-11 items-center justify-center rounded-md bg-card text-primary">
        <Layers aria-hidden="true" className="size-5" />
      </span>
      <div>
        <h3 className="text-h3 text-foreground">{routine.title}</h3>
        {routine.description ? (
          <p className="mt-1 line-clamp-2 text-support text-muted-foreground">{routine.description}</p>
        ) : null}
      </div>
      <p className="text-caption font-medium text-secondary-foreground">{formatStepCount(routine.stepCount, locale)}</p>
      <Link
        href={routine.href}
        className="mt-auto inline-flex min-h-11 items-center gap-1 text-support font-semibold text-primary after:absolute after:inset-0 hover:text-primary-hover focus-visible:outline-offset-[-3px]"
      >
        {ctaLabel}
        <ArrowLeft aria-hidden="true" className="size-4 ltr:rotate-180" />
      </Link>
    </article>
  );
}
