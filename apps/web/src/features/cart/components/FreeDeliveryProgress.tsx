'use client';

import { Icon } from '@/components/ui/icon';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { formatEgp, formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { calculateFreeDeliveryProgress } from '../lib/free-delivery';

export interface FreeDeliveryProgressProps {
  total: number;
  threshold?: number;
  className?: string;
}

export function FreeDeliveryProgress({
  total,
  threshold: customThreshold,
  className,
}: FreeDeliveryProgressProps) {
  const m = useMessages();
  const locale = useLocale();

  const { threshold, remaining, progressPct, reached } = calculateFreeDeliveryProgress(
    total,
    customThreshold
  );

  const formattedRemaining = formatEgp(remaining, 'EGP', locale) ?? `${remaining} EGP`;
  const formattedThreshold = formatEgp(threshold, 'EGP', locale) ?? `${threshold} EGP`;

  return (
    <div
      className={cn(
        'rounded-card border border-line/70 bg-linen/95 p-4 shadow-elevation-1',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-pill transition-colors',
              reached ? 'bg-ok-tint text-ok' : 'bg-sand/60 text-cobalt'
            )}
            aria-hidden="true"
          >
            <Icon name={reached ? 'check' : 'truck'} size={18} />
          </span>
          <div className="flex flex-col text-start">
            <span className="text-13.5 font-bold leading-20 text-ink md:text-14">
              {reached
                ? m.cartFreeShippingUnlocked
                : fillMessage(m.cartFreeShippingRemaining, { amount: formattedRemaining })}
            </span>
            <span className="text-12 leading-16 text-stone">
              {fillMessage(m.cartFreeShippingThresholdHint, { threshold: formattedThreshold })}
            </span>
          </div>
        </div>

        <span
          className={cn(
            'shrink-0 rounded-pill px-2.5 py-0.5 text-12 font-bold tabular-nums',
            reached ? 'bg-ok-tint text-ok' : 'bg-sand/70 text-ink'
          )}
        >
          {reached ? m.checkoutFree : `${formatNumber(progressPct, locale)}%`}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={
          reached
            ? m.cartFreeShippingUnlocked
            : fillMessage(m.cartFreeShippingRemaining, { amount: formattedRemaining })
        }
        className="relative h-2 w-full overflow-hidden rounded-pill bg-sand/60"
      >
        <div
          className={cn(
            'h-full rounded-pill transition-all duration-500 ease-out',
            reached ? 'bg-ok' : 'bg-cobalt'
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
