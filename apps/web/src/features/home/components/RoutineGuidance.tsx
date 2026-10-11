import { Moon, Sun } from 'lucide-react';
import { formatNumber } from '@/lib/i18n/format';
import type { Locale, Messages } from '@/lib/i18n/messages';
import { SKIN_CARE_ORDER } from '../data/home-content';
import { SectionHeading } from './SectionHeading';
import { SequenceTrack } from './SequenceTrack';

const ICONS = { morning: Sun, evening: Moon } as const;

export function RoutineGuidance({ m, locale }: { m: Messages; locale: Locale }) {
  const formatIndex = (n: number) => formatNumber(n, locale);
  return (
    <section aria-labelledby="guidance-title" className="pt-12 md:pt-16">
      <SectionHeading id="guidance-title" title={m.guidanceTitle} subtitle={m.guidanceSubtitle} />
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2">
        {SKIN_CARE_ORDER.map((sequence) => {
          const Icon = ICONS[sequence.id];
          return (
            <div key={sequence.id} className="bg-card px-5 py-5 md:px-6 md:py-6">
              <h3 className="flex items-center gap-2 text-body font-semibold text-foreground">
                <Icon aria-hidden="true" className="size-5 text-primary" strokeWidth={1.75} />
                {m[sequence.labelKey]}
              </h3>
              <SequenceTrack
                items={sequence.stepKeys.map((key) => m[key])}
                formatIndex={formatIndex}
                className="mt-5"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
