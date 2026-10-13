import { Rail } from '@/components/ui/rail';
import { SectionHeader } from '@/components/ui/section-header';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import type { RoutineSummary } from '../lib/routines';
import { RoutineCard } from './RoutineCard';

/**
 * Editorially selected routines (not personalised, hence "suggested" rather than "for you"). A swipeable rail
 * on phones and tablets (browsing set), a three-column grid from desktop. Omitted when there is nothing real to show.
 */
export function RecommendedRoutines({ routines }: { routines: RoutineSummary[] }) {
  if (routines.length === 0) return null;
  const locale = getLocale();
  const m = getMessages(locale);

  return (
    <section aria-labelledby="home-routines">
      <SectionHeader id="home-routines" title={m.routinesTitle} subtitle={m.routinesSubtitle} />
      <Rail className="lg:grid lg:grid-cols-3 lg:gap-4">
        {routines.map((routine) => (
          <div key={routine.id} className="flex w-[82%] shrink-0 snap-start sm:w-[46%] lg:w-auto">
            <RoutineCard routine={routine} ctaLabel={m.routineStart} locale={locale} />
          </div>
        ))}
      </Rail>
    </section>
  );
}
