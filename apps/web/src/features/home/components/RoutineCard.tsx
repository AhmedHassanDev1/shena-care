import Image from 'next/image';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import type { Locale } from '@/lib/i18n/messages';
import { defaultRoutineArtwork, formatStepCount } from '../lib/routines';
import type { RoutineSummary } from '../lib/routines';

/**
 * A multi-step routine as an editorial card (radius-m): copy on `paper-raised`, artwork on the opposite
 * side. Deliberately unlike a product card (no arch, no price, no cart). The design system grounds a
 * routine in its time of day (saffron morning, kohl evening); the catalog does not carry that yet, so
 * every card uses the neutral ground.
 */
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
    <article className="relative flex min-h-[11rem] w-full overflow-hidden rounded-md border border-border bg-card">
      <div className="flex flex-1 flex-col gap-1.5 p-5">
        <h3 className="text-title text-foreground">{routine.title}</h3>
        {routine.description ? <p className="line-clamp-2 text-body-s text-ink-soft">{routine.description}</p> : null}
        <p className="text-caption text-ink-soft">{formatStepCount(routine.stepCount, locale)}</p>
        <Link
          href={routine.href}
          className="mt-auto inline-flex min-h-control-m items-center gap-1 rounded-pill text-label text-primary [--stretched-link-radius:var(--radius-m)] stretched-link hover:text-primary-hover"
        >
          {ctaLabel}
          <Icon name="chevron-forward" size={18} />
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
