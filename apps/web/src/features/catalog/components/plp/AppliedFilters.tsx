'use client';

import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

export interface AppliedFilter {
  key: string;
  label: string;
  latin?: boolean;
  onRemove: () => void;
}

/**
 * Applied filters (PLPStates «فلاتر شغالة»): 36-tall linen chips with a 44×44 ✕ hit area, then «امسح الكل» in bottle.
 * Removing focuses nothing surprising: the chip simply leaves and the listing refreshes from the URL.
 */
export function AppliedFilters({ filters, onClearAll, className }: { filters: AppliedFilter[]; onClearAll: () => void; className?: string }) {
  const m = useMessages();
  if (!filters.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {filters.map((f) => (
        <span
          key={f.key}
          className="inline-flex h-9 flex-none items-center gap-1.5 whitespace-nowrap rounded-pill bg-linen pe-1.5 ps-3.5 text-13 font-semibold text-night shadow-outline-control"
        >
          <span lang={f.latin ? 'en' : undefined} dir={f.latin ? 'ltr' : 'auto'}>
            {f.label}
          </span>
          <button
            type="button"
            aria-label={fillMessage(m.plpRemove, { name: f.label })}
            onClick={f.onRemove}
            className="-my-1 -me-1.5 flex size-control-s items-center justify-center rounded-pill bg-transparent text-night"
          >
            <Icon name="close" size={16} strokeWidth={2} />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="ms-2 min-h-control-s bg-transparent px-1 text-14 font-semibold text-bottle underline underline-offset-4">
        {m.plpClearAll}
      </button>
    </div>
  );
}
