import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { BeadRail } from '@/components/ui/bead-rail';
import { Icon } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/messages';
import { formatStepCount } from '../lib/routines';
import type { RoutineSummary } from '../lib/routines';
import type { Atmosphere } from '../data/campaigns';

/** Mood from what the routine says about itself: evening lilac, morning peach, otherwise its care area. */
function routineAtmosphere(routine: RoutineSummary): Atmosphere {
  if (routine.timeOfDay === 'pm') return 'lilac';
  if (routine.timeOfDay === 'am') return 'peach';
  return routine.careArea === 'hair' ? 'malachite' : 'rose';
}

/**
 * A routine as a care JOURNEY, deliberately unlike product and category cards: a tinted ground, when-in-the-day
 * and care-area context, the bead rail (one bead per step) and a "start" action — no arch, price or cart.
 * Metadata appears only when the source provides it.
 */
export function RoutineCard({ routine, ctaLabel, locale }: { routine: RoutineSummary; ctaLabel: string; locale: Locale }) {
  const m = getMessages(locale);
  const time =
    routine.timeOfDay === 'am'
      ? { icon: 'sun' as const, label: m.routineMorning }
      : routine.timeOfDay === 'pm'
        ? { icon: 'moon' as const, label: m.routineEvening }
        : routine.timeOfDay === 'any'
          ? { icon: 'clock' as const, label: m.routineAnytime }
          : null;

  return (
    <article
      data-atmosphere={routineAtmosphere(routine)}
      className="relative flex h-full w-full flex-col gap-4 overflow-hidden rounded-md bg-gradient-to-br from-atm-wash to-atm-surface p-5"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -end-10 -top-10 size-36 rounded-pill bg-atm-accent/25 blur-2xl" />

      <div className="relative flex flex-wrap items-center gap-2">
        <Badge variant="neutral" className="bg-card text-atm-ink">
          {routine.careArea === 'hair' ? m.careAreaHair : m.careAreaSkin}
        </Badge>
        {time ? (
          <Badge variant="neutral" className="bg-card text-atm-ink">
            <Icon name={time.icon} size={16} />
            {time.label}
          </Badge>
        ) : null}
        {routine.id.startsWith('preview-') ? <Badge variant="guide">{m.previewTag}</Badge> : null}
      </div>

      <div className="relative grid gap-1.5">
        <h3 className="text-title text-foreground">{routine.title}</h3>
        {routine.description ? <p className="line-clamp-2 text-body-s text-ink-soft">{routine.description}</p> : null}
      </div>

      <div className="relative mt-auto grid gap-3">
        <BeadRail count={routine.stepCount} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-label text-atm-ink">{formatStepCount(routine.stepCount, locale)}</p>
          <Link
            href={routine.href}
            className="stretched-link inline-flex min-h-control-m items-center gap-1 rounded-pill bg-card px-4 text-label text-primary transition-colors duration-quick [--stretched-link-radius:var(--radius-md)] hover:bg-primary hover:text-primary-foreground"
          >
            {ctaLabel}
            <Icon name="chevron-forward" size={18} />
          </Link>
        </div>
      </div>
    </article>
  );
}
