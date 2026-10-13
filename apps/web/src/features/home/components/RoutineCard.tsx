import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { BeadRail } from '@/components/ui/bead-rail';
import { Icon } from '@/components/ui/icon';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
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
 * The cover: an arch window onto the time of day — a sun rising for morning, a crescent for evening, a drop
 * when the routine has no set time. Brand vector (arches, discs, beads), no photograph, so routines never
 * repeat Home's photography. Decorative: the time is written in the chip over it.
 */
function RoutineCover({ timeOfDay, className }: { timeOfDay: RoutineSummary['timeOfDay']; className?: string }) {
  return (
    <svg viewBox="0 0 320 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true" className={cn('rtl:-scale-x-100', className)}>
      {/* Arch window on the end side, with a soft sky inside it. */}
      <path d="M196 120V72a56 56 0 0 1 112 0v48z" className="fill-atm-wash" />
      <path d="M220 120V84a32 32 0 0 1 64 0v36z" className="fill-atm-accent/15" />
      {timeOfDay === 'am' ? (
        <g>
          <circle cx="252" cy="96" r="20" className="fill-atm-accent/80" />
          <circle cx="252" cy="96" r="30" fill="none" strokeWidth="1.5" className="stroke-atm-accent/40" />
        </g>
      ) : timeOfDay === 'pm' ? (
        <g>
          <circle cx="252" cy="78" r="17" className="fill-atm-accent/80" />
          <circle cx="261" cy="72" r="15" className="fill-atm-wash" />
          <circle cx="226" cy="62" r="2" className="fill-atm-ink/50" />
          <circle cx="282" cy="96" r="1.5" className="fill-atm-ink/50" />
        </g>
      ) : (
        <path d="M252 62c9 11 15 19 15 26a15 15 0 0 1-30 0c0-7 6-15 15-26z" className="fill-atm-accent/75" />
      )}
      {/* The horizon: a rail of beads running out of the arch. */}
      <path d="M0 116h320" strokeWidth="1.5" className="stroke-atm-ink/15" />
      <circle cx="150" cy="116" r="4" className="fill-atm-accent/60" />
      <circle cx="120" cy="116" r="3" className="fill-atm-accent/40" />
      <circle cx="94" cy="116" r="2" className="fill-atm-accent/30" />
    </svg>
  );
}

/**
 * A routine as a guided JOURNEY rather than a widget: an illustrated time-of-day cover, then the editorial
 * part — what it targets, its name, a line of intent — and the bead rail (one bead per step) leading to
 * "start". No arch niche, price or cart, so it never reads as a product. Metadata appears only when the
 * source provides it.
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
      className="group relative flex h-full w-full flex-col overflow-hidden rounded-lg bg-card ring-1 ring-inset ring-border"
    >
      <div className="relative h-28 bg-atm-surface">
        <RoutineCover timeOfDay={routine.timeOfDay} className="absolute inset-0 size-full" />
        <div className="absolute start-4 top-4 flex flex-wrap gap-1.5">
          {time ? (
            <Badge variant="neutral" className="bg-card text-atm-ink">
              <Icon name={time.icon} size={16} />
              {time.label}
            </Badge>
          ) : null}
          <Badge variant="neutral" className="bg-card/70 text-atm-ink">
            {routine.careArea === 'hair' ? m.careAreaHair : m.careAreaSkin}
          </Badge>
        </div>
        {routine.id.startsWith('preview-') ? <Badge variant="guide" className="absolute bottom-3 start-4 bg-card">{m.previewTag}</Badge> : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="grid gap-1">
          {routine.concern ? <p className="text-label text-atm-ink">{fillMessage(m.routineConcern, { concern: routine.concern })}</p> : null}
          <h3 className="text-title text-foreground">{routine.title}</h3>
          {routine.description ? <p className="line-clamp-2 text-body-s text-ink-soft">{routine.description}</p> : null}
        </div>

        <div className="mt-auto grid gap-3 pt-1">
          <div className="flex items-center gap-3">
            <BeadRail count={routine.stepCount} className="flex-1" />
            <p className="shrink-0 text-label text-foreground">{formatStepCount(routine.stepCount, locale)}</p>
          </div>
          <Link
            href={routine.href}
            className="stretched-link inline-flex min-h-control-m w-fit items-center gap-1 rounded-pill bg-primary px-5 text-label text-primary-foreground transition-colors duration-quick [--stretched-link-radius:var(--radius-l)] hover:bg-primary-hover"
          >
            {ctaLabel}
            <Icon name="chevron-forward" size={18} />
          </Link>
        </div>
      </div>
    </article>
  );
}
