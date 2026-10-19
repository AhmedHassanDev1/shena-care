'use client';

import { useState, type ReactNode } from 'react';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import type { DiscoveryFacet, DiscoveryFilters } from '../../api/discovery';
import { categoryLabel } from '../../lib/card-model';

export interface FacetGroups {
  type: DiscoveryFacet[];
  brand: DiscoveryFacet[];
}

interface FilterPanelProps {
  value: DiscoveryFilters;
  onChange: (next: DiscoveryFilters) => void;
  groups: FacetGroups;
  /** Desktop rail: checkbox rows. Phone sheet: type as pills, brand as checkbox rows (PLPStates §٧). */
  variant: 'rail' | 'sheet';
}

/**
 * Filter groups «النوع» (the catalog's child categories) and «الماركة», each count computed with every other filter
 * (PLPStates «الأعداد جنب كل اختيار محسوبة مع باقي الفلاتر»). The discovery API accepts one value per facet, so a
 * group holds one choice: picking another replaces it (multi-select needs an API change — recorded as a gap).
 * The board's «المشكلة», «السعر» and sort controls have no API behind them and are not rendered.
 */
export function FilterPanel({ value, onChange, groups, variant }: FilterPanelProps) {
  const m = useMessages();
  const locale = useLocale();
  const typeOptions = groups.type.map((f) => ({ ...f, label: categoryLabel(f, locale) ?? f.name }));

  return (
    <div className="flex flex-col">
      <FilterGroup title={m.plpType} active={value.category && groups.type.some((f) => f.slug === value.category) ? 1 : 0}>
        {variant === 'sheet' ? (
          <div className="flex flex-wrap gap-2">
            {typeOptions.map((option) => (
              <Chip
                key={option.slug}
                selected={value.category === option.slug}
                count={formatNumber(option.count, locale)}
                onClick={() => onChange({ ...value, category: value.category === option.slug ? undefined : option.slug })}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        ) : (
          typeOptions.map((option) => (
            <CheckRow
              key={option.slug}
              checked={value.category === option.slug}
              label={option.label}
              count={option.count}
              onToggle={() => onChange({ ...value, category: value.category === option.slug ? undefined : option.slug })}
            />
          ))
        )}
      </FilterGroup>
      <FilterGroup title={m.plpBrand} active={value.brand ? 1 : 0}>
        {groups.brand.map((option) => (
          <CheckRow
            key={option.slug}
            checked={value.brand === option.slug}
            label={option.name.toUpperCase()}
            latin
            count={option.count}
            onToggle={() => onChange({ ...value, brand: value.brand === option.slug ? undefined : option.slug })}
          />
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ title, active, children }: { title: string; active: number; children: ReactNode }) {
  const locale = useLocale();
  const [open, setOpen] = useState(true);
  return (
    <div className="pb-3 pt-1.5 shadow-hairline-bottom">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-control-m w-full items-center justify-between gap-2 bg-transparent p-0 text-15 font-bold text-night"
      >
        <span className="inline-flex items-center gap-2">
          {title}
          {active ? (
            <span className="inline-flex size-5.5 items-center justify-center rounded-full bg-blue text-12 font-bold text-white">{formatNumber(active, locale)}</span>
          ) : null}
        </span>
        <Icon name="chevron-down" size={16} strokeWidth={2} className={cn('transition-transform duration-fast', !open && 'rotate-180')} />
      </button>
      {open ? <div className="flex flex-col">{children}</div> : null}
    </div>
  );
}

function CheckRow({ checked, label, count, latin, onToggle }: { checked: boolean; label: string; count: number; latin?: boolean; onToggle: () => void }) {
  const m = useMessages();
  const locale = useLocale();
  const disabled = count === 0 && !checked;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={fillMessage(m.plpFilterLabel, { name: label, n: formatNumber(count, locale) })}
      onClick={disabled ? undefined : onToggle}
      className={cn('flex min-h-control-s w-full items-center gap-3 bg-transparent p-0 text-14 leading-22 text-night', disabled && 'cursor-default opacity-[.42]')}
    >
      <span
        aria-hidden="true"
        className={cn('flex size-5 flex-none items-center justify-center rounded-6', checked ? 'bg-blue text-white' : 'bg-linen shadow-outline-check')}
      >
        {checked ? <Icon name="check" size={14} strokeWidth={3} /> : null}
      </span>
      <span lang={latin ? 'en' : undefined} dir={latin ? 'ltr' : undefined} className={cn('text-match-parent', latin && 'text-12.5 font-semibold tracking-brand')}>
        {label}
      </span>
      <span aria-hidden="true" className="ms-auto text-12.5 tabular-nums text-ink-3">
        {formatNumber(count, locale)}
      </span>
    </button>
  );
}
