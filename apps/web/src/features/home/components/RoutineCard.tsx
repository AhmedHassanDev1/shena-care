import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { Locale } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import { defaultRoutineArtwork, formatStepCount } from '../lib/routines';
import type { RoutineSummary } from '../lib/routines';

/** Pastel grounds in rotation (blush, powder blue, warm neutral), as in the approved editorial row. */
const GROUNDS = ['bg-primary-subtle', 'bg-secondary', 'bg-muted'] as const;

/**
 * A multi-step routine as an editorial card: copy on a pastel ground, artwork on the opposite side.
 * Deliberately unlike a product card (no price, no cart).
 */
export function RoutineCard({
  routine,
  ctaLabel,
  locale,
  index = 0,
}: {
  routine: RoutineSummary;
  ctaLabel: string;
  locale: Locale;
  index?: number;
}) {
  return (
    <article
      className={cn(
        'relative flex min-h-[11rem] w-full overflow-hidden rounded-md border border-border',
        GROUNDS[index % GROUNDS.length],
      )}
    >
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="text-h3 text-foreground">{routine.title}</h3>
        {routine.description ? (
          <p className="line-clamp-2 text-support text-secondary-foreground">{routine.description}</p>
        ) : null}
        <p className="text-caption font-medium text-secondary-foreground">{formatStepCount(routine.stepCount, locale)}</p>
        <Link
          href={routine.href}
          className="mt-auto inline-flex min-h-11 items-center gap-1 text-support font-semibold text-primary after:absolute after:inset-0 hover:text-primary-hover focus-visible:outline-offset-[-3px]"
        >
          {ctaLabel}
          <ArrowLeft aria-hidden="true" className="size-4 ltr:rotate-180" />
        </Link>
      </div>
      <div aria-hidden="true" className="relative w-2/5 shrink-0">
        <Image
          src={routine.imageSrc ?? defaultRoutineArtwork(routine.careArea)}
          alt=""
          fill
          sizes="(min-width: 1024px) 180px, 40vw"
          className="object-cover object-right"
        />
      </div>
    </article>
  );
}
