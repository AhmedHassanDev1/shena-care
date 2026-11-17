'use client';

import { ProductTile } from '@/components/ui/product-tile';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

export interface SubcategoryItem {
  slug: string;
  label: string;
  /** Products the backend counts in this subcategory (after every sellability gate). */
  count: number;
  /** Real catalog packshot of a product in this subcategory; null shows the labelled placeholder, never a drawing. */
  imageUrl: string | null;
  imageAlt: string;
}

interface SubcategoryRailProps {
  ariaLabel: string;
  departmentLabel: string;
  /** Total products in the department («كل …» tile). */
  total: number | null;
  /** Selected child slug; undefined = the whole department. */
  selected: string | undefined;
  items: SubcategoryItem[];
  onSelect: (slug: string | undefined) => void;
}

const tile =
  'group flex w-36 flex-none snap-start flex-col gap-2 rounded-card bg-linen p-2 text-start shadow-outline-hairline transition-[box-shadow,transform] duration-fast ease-standard hover:shadow-elevation-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt sm:w-40 md:w-auto md:min-w-0 md:max-w-56 md:flex-1';

/**
 * Subcategory selector of a department page: the department's real child categories as compact packshot tiles
 * (one real product photo each, the backend count beneath). It sits directly above the listing and only changes the
 * `category` filter, so the results below update in place; there is no intermediate page. Phones scroll it
 * horizontally with snap; wider screens lay the tiles out in one row.
 */
export function SubcategoryRail({ ariaLabel, departmentLabel, total, selected, items, onSelect }: SubcategoryRailProps) {
  const m = useMessages();
  const locale = useLocale();
  const state = (active: boolean) => (active ? 'shadow-none ring-2 ring-cobalt' : '');

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 pt-0.5 scrollbar-none sm:-mx-0 sm:px-0 md:gap-3"
    >
      <button type="button" aria-pressed={!selected} onClick={() => onSelect(undefined)} className={cn(tile, state(!selected))}>
        <span className="flex h-24 w-full flex-col items-center justify-center gap-0.5 rounded-image bg-sand/50 md:h-28">
          <bdi className="font-display text-30 font-extrabold leading-none text-ink">{total !== null ? formatNumber(total, locale) : '–'}</bdi>
          <span className="text-12 font-medium text-stone">{fillMessage(m.plpCount, { n: '' }).trim()}</span>
        </span>
        <span className={cn('truncate px-1 font-display text-14 font-bold', !selected ? 'text-cobalt' : 'text-ink')}>
          {fillMessage(m.plpAllInDept, { dept: departmentLabel })}
        </span>
      </button>
      {items.map((item) => {
        const active = selected === item.slug;
        return (
          <button
            key={item.slug}
            type="button"
            aria-pressed={active}
            aria-label={`${item.label} · ${fillMessage(m.plpCount, { n: formatNumber(item.count, locale) })}`}
            onClick={() => onSelect(active ? undefined : item.slug)}
            className={cn(tile, state(active))}
          >
            <ProductTile
              src={item.imageUrl}
              alt=""
              name={item.label}
              fit="contain"
              sizes="(min-width: 768px) 200px, 160px"
              className="aspect-auto h-24 w-full bg-sand/40 md:h-28 [&_img]:p-1.5 [&_img]:mix-blend-multiply"
            />
            <span className="flex items-baseline justify-between gap-2 px-1">
              <span className={cn('truncate font-display text-14 font-bold', active ? 'text-cobalt' : 'text-ink')}>{item.label}</span>
              <bdi className="flex-none text-12 font-medium text-stone">{formatNumber(item.count, locale)}</bdi>
            </span>
          </button>
        );
      })}
    </div>
  );
}
