'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { ProductTile } from '@/components/ui/product-tile';
import { SearchField } from '@/components/ui/search-field';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { formatEgp } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import type { CareArea, StepTiming } from '../api/personal-routines';
import { useRoutineCatalog, useSuggestions } from '../hooks/useCatalog';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { roleLabel, type PickOption } from '../lib/catalog';
import { timingSentence } from '../lib/labels';

export interface PickerTarget {
  mode: 'add' | 'replace';
  /** Time of day the product will live in (decides which products read as «already in your routine»). */
  timing: StepTiming;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PickerTarget;
  careArea: CareArea;
  /** SKUs already used at `target.timing`. */
  takenSkus: ReadonlySet<string>;
  /** True when no more steps fit. */
  full: boolean;
  onPick: (option: PickOption) => void;
}

type AreaFilter = 'ALL' | 'SKIN' | 'HAIR';

function OptionRow({ option, taken, disabled, suggested, onPick, timing }: { option: PickOption; taken: boolean; disabled: boolean; suggested?: boolean; onPick: () => void; timing: StepTiming }) {
  const m = useMessages();
  const locale = useLocale();
  const price = option.price ? formatEgp(option.price.amount, option.price.currency, locale) : null;
  const role = roleLabel(option.role, locale);
  const hint = option.periodHint === 'AM' ? m.rtMorningLong : option.periodHint === 'PM' ? m.rtEveningLong : null;
  const label = [option.name, option.variant].filter(Boolean).join(' · ');
  return (
    <li className="border-b border-ink/10 last:border-b-0">
      <button
        type="button"
        disabled={disabled || taken}
        onClick={onPick}
        aria-label={taken ? fillMessage(m.rtPickInRoutine, { period: timingSentence(m, timing) }) + ': ' + label : fillMessage(m.rtPickChoose, { name: label })}
        className={cn(
          'flex w-full items-start gap-3.5 px-1 py-3.5 text-start transition-colors duration-fast ease-standard',
          'enabled:hover:bg-sand/40 disabled:cursor-not-allowed'
        )}
      >
        <ProductTile src={option.imageUrl} alt="" name={option.name} size="thumb" className={cn('size-16 shrink-0 rounded-image', taken && 'opacity-60')} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-display text-14 leading-20 text-stone">
            <bdi>{option.brand}</bdi>
            {role ? ` · ${role}` : ''}
          </span>
          <span className="font-display text-16 font-semibold leading-24 text-ink">
            <bdi>{label}</bdi>
          </span>
          {suggested && option.suggestedReason ? <span className="font-display text-13 leading-20 text-ink">{option.suggestedReason}</span> : null}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-13 leading-20 text-stone">
            {price ? <span className="font-semibold text-ink">{price}</span> : null}
            {hint ? <span>{fillMessage(m.rtPeriodHint, { period: hint })}</span> : null}
            {!option.canOrder ? <span className="font-semibold text-tomato-ink">{m.rtStateUnavailable}</span> : null}
          </span>
        </span>
        {taken ? (
          <StatusChip tone="ok" className="mt-1 shrink-0">
            <Icon name="check" size={14} strokeWidth={2.4} className="me-1" />
            {m.rtPickInRoutine.replace('{period}', timingSentence(m, timing))}
          </StatusChip>
        ) : (
          <span aria-hidden="true" className="mt-1 inline-flex size-control-s shrink-0 items-center justify-center rounded-pill bg-linen text-cobalt shadow-outline-control">
            <Icon name="plus" size={18} />
          </span>
        )}
      </button>
    </li>
  );
}

/** Bottom sheet (phone) / side panel (desktop) to pick one real catalog variant for a step. */
export function ProductPickerSheet({ open, onOpenChange, target, careArea, takenSkus, full, onPick }: Props) {
  const m = useMessages();
  const locale = useLocale();
  const desktop = useMediaQuery('(min-width: 1024px)');
  const catalog = useRoutineCatalog();
  const suggestions = useSuggestions(careArea, catalog.bySku, open);
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<AreaFilter>(careArea === 'hair' ? 'HAIR' : 'SKIN');
  const [role, setRole] = useState<string | null>(null);

  const text = query.trim().toLowerCase();
  const inArea = (option: PickOption) => area === 'ALL' || !option.domain || option.domain === area;
  const filtered = useMemo(
    () =>
      catalog.options.filter(
        (option) =>
          inArea(option) &&
          (!role || option.role === role) &&
          (!text || `${option.name} ${option.brand} ${option.variant ?? ''}`.toLowerCase().includes(text))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.options, area, role, text]
  );
  const roles = useMemo(() => [...new Set(catalog.options.filter(inArea).map((option) => option.role).filter((r): r is string => !!r))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.options, area]);
  const showSuggestions = target.mode === 'add' && !text && !role && !!suggestions.data?.length;
  const blockAdd = full && target.mode === 'add';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? 'end' : 'bottom'}
        closeLabel={m.rtClose}
        className={cn('h-[88dvh] lg:h-full lg:max-w-lg', desktop && 'w-full')}
      >
        <SheetHeader>
          <SheetTitle>{target.mode === 'replace' ? m.rtPickReplaceTitle : m.rtPickTitle}</SheetTitle>
          <SheetDescription>
            {target.mode === 'add' ? fillMessage(m.rtPickTitleFor, { period: timingSentence(m, target.timing) }) : m.rtPickLead}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-2">
          <SearchField
            label={m.rtSearchLabel}
            id="routine-picker-search"
            name="routine-picker-search"
            variant="compact"
            placeholder={m.rtSearchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFormSubmit={(event) => event.preventDefault()}
          />
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={m.rtAreaLabel}>
            {(['SKIN', 'HAIR', 'ALL'] as const).map((value) => (
              <Chip key={value} selected={area === value} onClick={() => { setArea(value); setRole(null); }}>
                {value === 'SKIN' ? m.rtAreaSkin : value === 'HAIR' ? m.rtAreaHair : m.rtFilterAll}
              </Chip>
            ))}
            {roles.map((value) => (
              <Chip key={value} selected={role === value} onClick={() => setRole(role === value ? null : value)}>
                {roleLabel(value, locale) ?? value}
              </Chip>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {blockAdd ? <MessageBox tone="warn" className="mb-3">{fillMessage(m.rtPickFull, { n: 30 })}</MessageBox> : null}

          {showSuggestions ? (
            <section aria-labelledby="picker-suggested" className="mb-4">
              <h3 id="picker-suggested" className="m-0 font-display text-16 font-bold text-ink">{m.rtSuggestedTitle}</h3>
              <p className="m-0 mb-1 font-display text-13 leading-20 text-stone">{m.rtSuggestedNote}</p>
              <ul className="m-0 list-none p-0">
                {suggestions.data!.map((option) => (
                  <OptionRow key={`s-${option.skuId}`} option={option} suggested timing={target.timing} taken={takenSkus.has(option.skuId)} disabled={blockAdd} onPick={() => onPick(option)} />
                ))}
              </ul>
            </section>
          ) : target.mode === 'add' && suggestions.isError && !text && !role ? (
            <MessageBox tone="info" className="mb-3">{m.rtSuggestedError}</MessageBox>
          ) : null}

          {catalog.isPending ? (
            <div aria-busy="true" className="flex flex-col gap-3">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="flex items-center gap-3.5">
                  <Skeleton className="size-16 shrink-0" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-1/3 rounded-pill" />
                    <Skeleton className="h-5 w-3/4 rounded-pill" />
                  </div>
                </div>
              ))}
            </div>
          ) : catalog.isError ? (
            <MessageBox tone="err" title={m.rtPickLoadError}>
              <Button variant="ghost" size="xs" onClick={() => catalog.refetch()} className="mt-1 self-start">{m.tryAgain}</Button>
            </MessageBox>
          ) : filtered.length === 0 ? (
            <p role="status" className="m-0 py-8 text-center font-display text-15 text-stone">{m.rtPickEmpty}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {filtered.map((option) => (
                <OptionRow key={option.skuId} option={option} timing={target.timing} taken={takenSkus.has(option.skuId)} disabled={blockAdd} onPick={() => onPick(option)} />
              ))}
            </ul>
          )}
        </div>

        <SheetFooter>
          <Button variant="ink" size="m" className="flex-1" onClick={() => onOpenChange(false)}>
            {m.rtDone}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
