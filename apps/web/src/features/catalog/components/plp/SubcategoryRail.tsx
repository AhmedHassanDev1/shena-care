'use client';

import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

export interface SubcategoryItem {
  slug: string;
  label: string;
  /** Products the backend counts in this subcategory (after every sellability gate). */
  count: number;
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

/** Icon per catalog product type (UI chrome only; never stands in for a product photo). Unknown types get a neutral glyph. */
const TYPE_ICONS: Record<string, IconName> = {
  cleansers: 'pump',
  moisturizers: 'jar',
  'serums-treatments': 'dropper',
  sunscreens: 'sun',
  shampoos: 'pump',
  conditioners: 'tube',
  'hair-treatments-styling': 'sparkles',
};
export const subcategoryIcon = (slug: string): IconName => TYPE_ICONS[slug] ?? 'sparkles';

/** One item: a small round icon with its label and count underneath; no card, border or shadow behind it. */
const item =
  'group flex flex-none snap-start flex-col items-center gap-2 bg-transparent px-1 py-0 text-center focus-visible:outline-none';
const disc = (active: boolean) =>
  cn(
    'flex size-14 items-center justify-center rounded-full transition-colors duration-fast ease-standard group-focus-visible:ring-2 group-focus-visible:ring-cobalt',
    active ? 'bg-cobalt text-chalk' : 'bg-sand/60 text-ink group-hover:bg-sand'
  );

/**
 * Subcategory selector of a department page: the department's real child categories as small round icons
 * (the product type, with its label and the backend count underneath, no card behind them). It sits directly above the listing and only changes the
 * `category` filter, so the results below update in place; there is no intermediate page. The row always scrolls
 * horizontally: touch swipes natively, a mouse drags it (a drag never selects a tile), a trackpad or shift+wheel scrolls it.
 */
export function SubcategoryRail({ ariaLabel, departmentLabel, total, selected, items, onSelect }: SubcategoryRailProps) {
  const m = useMessages();
  const locale = useLocale();
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, moved: false, x: 0, left: 0 });
  const [dragging, setDragging] = useState(false);

  // Mouse drag-to-scroll. scrollLeft grows as the viewport moves right (also in RTL), so the content follows the pointer.
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !rail.current) return;
    drag.current = { down: true, moved: false, x: event.clientX, left: rail.current.scrollLeft };
    const move = (e: MouseEvent) => {
      if (!drag.current.down || !rail.current) return;
      const dx = e.clientX - drag.current.x;
      if (!drag.current.moved && Math.abs(dx) > 5) {
        drag.current.moved = true;
        setDragging(true);
      }
      if (drag.current.moved) rail.current.scrollLeft = drag.current.left - dx;
    };
    const up = () => {
      drag.current.down = false;
      setDragging(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  // A drag that ends over a tile must not select it.
  const swallowClickAfterDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (drag.current.moved) {
      event.preventDefault();
      event.stopPropagation();
      drag.current.moved = false;
    }
  };

  return (
    <div
      ref={rail}
      role="group"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      onClickCapture={swallowClickAfterDrag}
      className={cn(
        '-mx-4 flex gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 pt-0.5 scrollbar-none sm:-mx-0 sm:px-0 md:gap-4',
        dragging ? 'cursor-grabbing select-none' : 'cursor-grab snap-x scroll-smooth'
      )}
    >
      <button type="button" aria-pressed={!selected} onClick={() => onSelect(undefined)} className={item}>
        <span className={disc(!selected)}>
          <bdi className="font-display text-20 font-extrabold leading-none">{total !== null ? formatNumber(total, locale) : '–'}</bdi>
        </span>
        <span className={cn('whitespace-nowrap font-display text-13 font-bold leading-none', !selected ? 'text-cobalt' : 'text-ink')}>
          {fillMessage(m.plpAllInDept, { dept: departmentLabel })}
        </span>
      </button>
      {items.map((entry) => {
        const active = selected === entry.slug;
        return (
          <button
            key={entry.slug}
            type="button"
            aria-pressed={active}
            aria-label={`${entry.label} · ${fillMessage(m.plpCount, { n: formatNumber(entry.count, locale) })}`}
            onClick={() => onSelect(active ? undefined : entry.slug)}
            className={item}
          >
            <span aria-hidden="true" className={disc(active)}>
              <Icon name={subcategoryIcon(entry.slug)} size={26} strokeWidth={1.6} />
            </span>
            <span className={cn('whitespace-nowrap font-display text-13 font-bold leading-none', active ? 'text-cobalt' : 'text-ink')}>
              {entry.label} <bdi className="font-medium text-stone">{formatNumber(entry.count, locale)}</bdi>
            </span>
          </button>
        );
      })}
    </div>
  );
}
