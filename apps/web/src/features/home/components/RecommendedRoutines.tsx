import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import type { RoutineSummary } from '../lib/routines';
import { RoutineCard } from './RoutineCard';
import { SectionHeader } from '@/components/ui/section-header';

/**
 * Editorially selected routines (not personalised, hence "suggested" rather than "for you").
 * Omitted entirely when there is nothing real to show.
 */
export function RecommendedRoutines({ routines }: { routines: RoutineSummary[] }) {
  if (routines.length === 0) return null;
  const locale = getLocale();
  const m = getMessages(locale);

  return (
    <section aria-labelledby="home-routines">
      <SectionHeader id="home-routines" title={m.routinesTitle} subtitle={m.routinesSubtitle} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        {routines.map((routine) => (
          <li key={routine.id} className="flex">
            <RoutineCard routine={routine} ctaLabel={m.routineCta} locale={locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}
