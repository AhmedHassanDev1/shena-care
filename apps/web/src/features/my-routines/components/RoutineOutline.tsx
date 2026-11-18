'use client';

import { Icon } from '@/components/ui/icon';
import { formatNumber } from '@/lib/i18n/format';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import { useRoutinePeriod } from '../hooks/RoutinePeriodProvider';
import { stepsOf, type Draft } from '../lib/draft';
import { stepsLabel, timingSentence } from '../lib/labels';
import type { RoutinePeriod } from '../lib/period';

const PERIODS: Array<{ value: RoutinePeriod; icon: 'sun' | 'evening' }> = [
  { value: 'AM', icon: 'sun' },
  { value: 'PM', icon: 'evening' },
];

/** The whole routine at a glance, morning above evening, in use order. Selecting a heading switches the page to that time of day. */
export function RoutineOutline({ draft, className }: { draft: Draft; className?: string }) {
  const m = useMessages();
  const { period, choose } = useRoutinePeriod();
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {PERIODS.map(({ value, icon }) => {
        const steps = stepsOf(draft, value);
        return (
          <section key={value} aria-label={value === 'AM' ? m.rtMorning : m.rtEvening} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => choose(value)}
              aria-pressed={period === value}
              className={cn(
                'flex items-center gap-2 self-start rounded-pill py-1 pe-3 font-display text-17 font-bold text-ink transition-colors duration-fast ease-standard hover:text-cobalt',
                period === value && 'text-cobalt'
              )}
            >
              <Icon name={icon} size={20} />
              {value === 'AM' ? m.rtMorning : m.rtEvening}
              <span className="font-display text-13 font-medium text-stone">{stepsLabel(m, steps.length, (n) => formatNumber(n))}</span>
            </button>
            {steps.length ? (
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                {steps.map((step, index) => (
                  <li key={step.key} className="flex items-baseline gap-3 font-display text-15 leading-24 text-ink">
                    <span aria-hidden="true" className="w-4 shrink-0 text-center font-serif text-18 italic text-cobalt tabular-nums">{formatNumber(index + 1)}</span>
                    <span className="min-w-0">
                      <span className="font-semibold">{step.title}</span>
                      <span className="text-stone"> · <bdi>{step.product.name}</bdi></span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-0 font-display text-14 text-stone">{fillMessage(m.rtNothingInPeriod, { period: timingSentence(m, value) })}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
