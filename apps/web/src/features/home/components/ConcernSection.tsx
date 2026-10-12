'use client';

import Link from 'next/link';
import { Droplet, Waves } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useConcerns } from '../hooks/useConcerns';
import type { Concern } from '../hooks/useConcerns';
import { SectionHeader } from './SectionHeader';

/** Rotating the three tints keeps neighbouring tiles distinct without a color per concern. */
const TINTS = ['bg-secondary', 'bg-accent', 'bg-primary-subtle'] as const;

function ConcernTile({ concern, index }: { concern: Concern; index: number }) {
  const Icon = concern.careArea === 'hair' ? Waves : Droplet;
  return (
    <Link
      href={routes.productsByConcern(concern.slug)}
      className="group flex w-24 shrink-0 snap-start flex-col items-center gap-2 rounded-md p-1 text-center focus-visible:outline-offset-0"
    >
      <span
        className={cn(
          'flex size-16 items-center justify-center rounded-md text-foreground transition-shadow duration-fast ease-standard group-hover:shadow-raised',
          TINTS[index % TINTS.length],
        )}
      >
        <Icon aria-hidden="true" className="size-7" />
      </span>
      <span className="line-clamp-2 min-h-[3.2em] text-caption font-medium text-foreground">{concern.name}</span>
    </Link>
  );
}

/**
 * Shop by concern. Concerns come from the care API (signed-in customers only); with no concerns the
 * section is omitted instead of showing invented categories. Labels are shopping aids, not diagnoses.
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
            <Skeleton key={index} className="h-28 w-24 shrink-0" />
          ))}
        </div>
      </section>
    );
  }
  if (concerns.length === 0) return null;

  return (
    <section aria-labelledby="home-concerns">
      <SectionHeader id="home-concerns" title={m.concernTitle} />
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {concerns.map((concern, index) => (
          <ConcernTile key={concern.id} concern={concern} index={index} />
        ))}
      </div>
    </section>
  );
}
