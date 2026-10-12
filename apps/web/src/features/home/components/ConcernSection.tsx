'use client';

import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { concernIcon } from '../lib/concerns';
import type { Concern } from '../lib/concerns';
import { useConcerns } from '../hooks/useConcerns';
import { SectionHeader } from './SectionHeader';

/** Rotating the three tints keeps neighbouring tiles distinct without a color per concern. */
const TINTS = ['bg-primary-subtle text-primary', 'bg-secondary text-secondary-foreground', 'bg-accent text-accent-foreground'] as const;

function ConcernTile({ concern, index }: { concern: Concern; index: number }) {
  const Icon = concernIcon(concern);
  return (
    <Link
      href={routes.productsByConcern(concern.slug)}
      className="group flex min-h-[7.5rem] w-28 shrink-0 snap-start flex-col items-center justify-center gap-2.5 rounded-md border border-border bg-card p-3 text-center transition-shadow duration-fast ease-standard hover:shadow-raised focus-visible:outline-offset-2 lg:w-auto"
    >
      <span className={cn('flex size-12 items-center justify-center rounded-full', TINTS[index % TINTS.length])}>
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <span className="line-clamp-2 min-h-[3.2em] text-caption font-medium text-foreground">{concern.name}</span>
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
        <Skeleton className="mb-4 h-7 w-40" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-[7.5rem] w-28 shrink-0" />
          ))}
        </div>
      </section>
    );
  }
  if (concerns.length === 0) return null;

  return (
    <section aria-labelledby="home-concerns">
      <SectionHeader id="home-concerns" title={m.concernTitle} />
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] lg:overflow-visible lg:px-0">
        {concerns.map((concern, index) => (
          <ConcernTile key={concern.id} concern={concern} index={index} />
        ))}
      </div>
    </section>
  );
}
