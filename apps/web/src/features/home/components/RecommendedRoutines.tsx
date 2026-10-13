import { Rail } from '@/components/ui/rail';
import { SectionHeader } from '@/components/ui/section-header';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import type { RoutineSummary } from '../lib/routines';
import { RoutineCard } from './RoutineCard';

/**
 * Editorially selected routines (not personalised, hence "suggested" rather than "for you").
 *
 * Phones: one dominant card per view with a deliberate peek of the next (a fixed 2.5rem, never a random
 * slice), snapping card by card to the page gutter. Tablet: two per view. Desktop: a three-column grid.
 * Omitted when there is nothing real to show.
 */
export function RecommendedRoutines({ routines }: { routines: RoutineSummary[] }) {
  if (routines.length === 0) return null;
  const locale = getLocale();
  const m = getMessages(locale);

  return (
    <section aria-labelledby="home-routines">
      <SectionHeader id="home-routines" title={m.routinesTitle} subtitle={m.routinesSubtitle} />
      <Rail className="snap-mandatory scroll-px-4 sm:scroll-px-6 lg:grid lg:grid-cols-3 lg:gap-4">
        {routines.map((routine) => (
          <div key={routine.id} className="flex w-[calc(100%-2.5rem)] shrink-0 snap-start sm:w-[calc(50%-1.5rem)] lg:w-auto">
            <RoutineCard routine={routine} ctaLabel={m.routineStart} locale={locale} />
          </div>
        ))}
      </Rail>
    </section>
  );
}
