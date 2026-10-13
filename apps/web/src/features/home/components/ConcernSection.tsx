'use client';

import Link from 'next/link';
import { ConcernGlyph } from '@/components/ui/concern-glyph';
import { Rail } from '@/components/ui/rail';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { concernGlyph } from '../lib/concerns';
import type { Concern } from '../lib/concerns';
import { useConcerns } from '../hooks/useConcerns';

function ConcernTile({ concern }: { concern: Concern }) {
  return (
    <Link
      href={routes.productsByConcern(concern.slug)}
      className="group flex min-h-[7.5rem] w-32 shrink-0 snap-start flex-col items-start gap-3 rounded-sm border border-border bg-card p-3 transition-colors duration-quick ease-out hover:border-foreground lg:w-auto"
    >
      <span className="grid size-12 place-items-center rounded-pill bg-sand text-foreground">
        <ConcernGlyph name={concernGlyph(concern)} />
      </span>
      <span className="line-clamp-2 min-h-[3.2em] text-heading text-foreground">{concern.name}</span>
    </Link>
  );
}

/**
 * Shop by concern. Real concerns (signed-in customers) win; in design preview fixtures fill in, and
 * otherwise the section is omitted. Labels are shopping aids, not diagnoses.
 */
export function ConcernSection() {
  const m = useMessages();
  const { concerns, isLoading } = useConcerns();

  if (isLoading) {
    return (
      <section aria-busy="true" aria-label={m.concernLoading}>
        <Skeleton shape="pill" className="mb-4 h-7 w-40" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-[7.5rem] w-32 shrink-0" />
          ))}
        </div>
      </section>
    );
  }
  if (concerns.length === 0) return null;

  return (
    <section aria-labelledby="home-concerns">
      <SectionHeader id="home-concerns" title={m.concernTitle} />
      <Rail className="lg:grid lg:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
        {concerns.map((concern) => (
          <ConcernTile key={concern.id} concern={concern} />
        ))}
      </Rail>
    </section>
  );
}
