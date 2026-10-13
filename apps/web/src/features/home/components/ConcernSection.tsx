'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { ConcernGlyph } from '@/components/ui/concern-glyph';
import { Icon } from '@/components/ui/icon';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { concernAtmosphere, concernGlyph } from '../lib/concerns';
import type { Concern } from '../lib/concerns';
import { useConcerns } from '../hooks/useConcerns';

const tile =
  'group relative flex min-h-[8.5rem] flex-col justify-between gap-3 rounded-md border p-4 transition-[border-color,transform] duration-quick ease-out hover:border-foreground active:scale-[0.98] active:duration-instant';

function ConcernTile({ concern }: { concern: Concern }) {
  const m = useMessages();
  return (
    <Link
      href={routes.productsByConcern(concern.slug)}
      data-atmosphere={concernAtmosphere(concern)}
      aria-label={fillMessage(m.concernCardLabel, { name: concern.name })}
      className={cn(tile, 'border-border bg-card')}
    >
      <span className="grid size-12 place-items-center rounded-pill bg-atm-surface text-atm-ink transition-colors duration-quick group-hover:bg-atm-accent group-hover:text-foreground">
        <ConcernGlyph name={concernGlyph(concern)} />
      </span>
      <span className="grid gap-1">
        <span className="line-clamp-2 text-heading text-foreground">{concern.name}</span>
        <span className="flex items-center justify-between text-caption text-ink-subtle">
          {concern.careArea === 'hair' ? m.careAreaHair : m.careAreaSkin}
          <Icon name="chevron-forward" size={16} className="text-ink-soft transition-transform duration-quick group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0 ltr:group-hover:translate-x-0.5" />
        </span>
      </span>
    </Link>
  );
}

/** Closing cell: the way out for people whose concern is not listed. */
function AllProductsTile() {
  const m = useMessages();
  return (
    <Link href={routes.products} data-atmosphere="malachite" className={cn(tile, 'border-transparent bg-atm-surface')}>
      <span className="grid size-12 place-items-center rounded-pill bg-primary text-primary-foreground">
        <Icon name="shelf" />
      </span>
      <span className="grid gap-1">
        <span className="text-heading text-foreground">{m.concernAllProducts}</span>
        <span className="flex items-center justify-between text-caption text-atm-ink">
          {m.concernAllProductsHint}
          <Icon name="chevron-forward" size={16} />
        </span>
      </span>
    </Link>
  );
}

/**
 * Shop by concern. A responsive GRID rather than a rail: the set is small (7 today), every option should be
 * visible without hidden horizontal scrolling, and a 2-up phone grid keeps 164px tiles (≥44px targets) with
 * equal heights. Real concerns win; in design preview fixtures fill in (and are labelled), otherwise the
 * section is omitted. Labels are shopping aids, not diagnoses.
 */
export function ConcernSection() {
  const m = useMessages();
  const { concerns, isLoading } = useConcerns();

  if (isLoading) {
    return (
      <section aria-busy="true" aria-label={m.concernLoading}>
        <Skeleton shape="pill" className="mb-4 h-7 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[8.5rem]" />
          ))}
        </div>
      </section>
    );
  }
  if (concerns.length === 0) return null;
  const isPreview = concerns.some((concern) => concern.id.startsWith('preview-'));

  return (
    <section id="home-concerns-section" aria-labelledby="home-concerns" className="scroll-mt-24">
      <SectionHeader id="home-concerns" title={m.concernTitle} subtitle={m.concernSubtitle} />
      {isPreview ? <Badge variant="guide" className="mb-3">{m.previewTag}</Badge> : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
        {concerns.map((concern) => (
          <li key={concern.id} className="flex [&>a]:w-full">
            <ConcernTile concern={concern} />
          </li>
        ))}
        <li className="flex [&>a]:w-full">
          <AllProductsTile />
        </li>
      </ul>
    </section>
  );
}
