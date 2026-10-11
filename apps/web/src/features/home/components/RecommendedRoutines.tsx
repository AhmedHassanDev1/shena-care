import { formatNumber } from '@/lib/i18n/format';
import type { Locale, Messages } from '@/lib/i18n/messages';
import { ROUTINE_TRACKS } from '../data/home-content';
import { RoutineCard } from './RoutineCard';
import { SectionHeading } from './SectionHeading';

export function RecommendedRoutines({ m, locale }: { m: Messages; locale: Locale }) {
  const formatIndex = (n: number) => formatNumber(n, locale);
  return (
    <section aria-labelledby="routines-title" className="pt-12 md:pt-16">
      <SectionHeading id="routines-title" title={m.routinesTitle} subtitle={m.routinesSubtitle} />
      <div className="grid gap-4 md:grid-cols-2 md:gap-5">
        {ROUTINE_TRACKS.map((track) => (
          <RoutineCard
            key={track.id}
            title={m[track.titleKey]}
            askLabel={m.routineAsk}
            questions={track.questionKeys.map((key) => m[key])}
            href={track.href}
            ctaLabel={m.routineCta}
            formatIndex={formatIndex}
          />
        ))}
      </div>
    </section>
  );
}
