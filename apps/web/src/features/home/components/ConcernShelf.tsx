'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { apiClient } from '@/lib/api-client';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';
import type { Concern } from '@/features/catalog/api/discovery';
import { CONCERN_CHIPS, concernHref } from '../lib/concern-chips';

/**
 * Shop by concern: one row of photo chips (scrolls sideways on phones, wraps on desktop). Each chip resolves against
 * GET /care/concerns and falls back to a search when the catalog has no matching concern.
 */
export function ConcernShelf() {
  const m = useMessages();
  const { data } = useQuery({
    queryKey: ['care', 'concerns', 'public'],
    queryFn: () => apiClient.get<Concern[]>('/care/concerns'),
    staleTime: 5 * 60 * 1000,
  });
  const concerns = data ?? [];

  return (
    <section aria-labelledby="home-concern-title" className="border-b border-line bg-linen/50 py-8 lg:py-10">
      <PageContainer className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id="home-concern-title" className="m-0 font-display text-22 font-bold text-ink lg:text-28">
            {m.homeConcernTitle}
          </h2>
          <p className="m-0 text-14 text-stone lg:text-15">{m.homeConcernBody}</p>
        </div>

        {/* Concern chips: each opens the listing filtered to that concern (or a search when the API lacks it) */}
        <nav aria-label={m.homeConcernNavLabel} className="pt-1">
          <ul className="scrollbar-none -mx-4 m-0 flex list-none snap-x gap-3 overflow-x-auto scroll-px-4 px-4 py-1.5 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
            {CONCERN_CHIPS.map((chip) => {
              const label = m[chip.label];
              const { href } = concernHref(chip, label, concerns);
              return (
                <li key={chip.id} className="flex-none snap-start">
                  <Link
                    href={href}
                    className={cn(
                      'group inline-flex h-13 items-center gap-3 rounded-pill bg-chalk py-1 pe-5 ps-1.5 text-14 font-semibold text-ink shadow-outline-control transition-[color,box-shadow,transform] duration-fast',
                      'hover:text-cobalt hover:shadow-outline-cobalt active:scale-[.98]'
                    )}
                  >
                    <div className="relative size-10 flex-none overflow-hidden rounded-full bg-sand">
                      <Image
                        src={chip.image}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-cover transition-transform duration-base ease-standard group-hover:scale-110"
                      />
                    </div>
                    <span className="whitespace-nowrap">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </PageContainer>
    </section>
  );
}
