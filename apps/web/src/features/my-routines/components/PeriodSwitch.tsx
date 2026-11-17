'use client';

import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/icon';
import { formatNumber } from '@/lib/i18n/format';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';
import { useRoutinePeriod } from '../hooks/RoutinePeriodProvider';
import type { RoutinePeriod } from '../lib/period';

const OPTIONS = [
  { value: 'AM', icon: 'sun' },
  { value: 'PM', icon: 'evening' },
] as const;

/**
 * Morning / Evening segmented control. Reads and writes the page's period, so changing it also changes the light behind
 * the page. A choice made here is the customer's and is never replaced by the clock.
 */
export function PeriodSwitch({ counts, className }: { counts?: Partial<Record<RoutinePeriod, number>>; className?: string }) {
  const m = useMessages();
  const { period, choose } = useRoutinePeriod();
  const refs = useRef<Record<RoutinePeriod, HTMLButtonElement | null>>({ AM: null, PM: null });
  const active: RoutinePeriod = period ?? 'AM';

  const onKeyDown = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: RoutinePeriod = event.key === 'Home' ? 'AM' : event.key === 'End' ? 'PM' : active === 'AM' ? 'PM' : 'AM';
    choose(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={m.rtPeriodSwitchLabel}
      onKeyDown={onKeyDown}
      className={cn('relative grid h-13 grid-cols-2 rounded-pill bg-sand/70 p-1 shadow-outline-hairline', className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-pill bg-cobalt shadow-elevation-1',
          'transition-transform duration-base ease-standard motion-reduce:transition-none',
          period === 'PM' && 'translate-x-full rtl:-translate-x-full',
          period === null && 'opacity-0'
        )}
      />
      {OPTIONS.map(({ value, icon }) => {
        const selected = period === value;
        const count = counts?.[value];
        return (
          <button
            key={value}
            ref={(node) => {
              refs.current[value] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={active === value ? 0 : -1}
            onClick={() => choose(value)}
            className={cn(
              'relative z-1 flex min-w-0 items-center justify-center gap-2 rounded-pill px-3 font-display text-16 font-semibold',
              'transition-colors duration-base ease-standard',
              selected ? 'text-chalk' : 'text-ink hover:text-cobalt'
            )}
          >
            <Icon name={icon} size={20} />
            <span className="truncate">{value === 'AM' ? m.rtMorning : m.rtEvening}</span>
            {count !== undefined ? (
              <bdi className={cn('rounded-pill px-2 text-13 leading-20', selected ? 'bg-chalk/20' : 'bg-ink/10')}>{formatNumber(count)}</bdi>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
