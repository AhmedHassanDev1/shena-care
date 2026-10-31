'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { apiClient } from '@/lib/api-client';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { Concern } from '@/features/catalog/api/discovery';
import { CONCERN_CHIPS, concernHref } from '../lib/concern-chips';

/**
 * Modern Beauty Editorial: Shop by Concern Discovery Strip
 * Prominently showcases real dermatological concern photography in elegant,
 * accessible horizontal discovery chips.
 */
export function ConcernShelf() {
  const m = useMessages();
  const locale = useLocale();
  const { data } = useQuery({
    queryKey: ['care', 'concerns', 'public'],
    queryFn: () => apiClient.get<Concern[]>('/care/concerns'),
    staleTime: 5 * 60 * 1000,
  });
  const concerns = data ?? [];

  return (
    <section aria-labelledby="home-concern-title" className="border-b border-line bg-linen/50 py-8 lg:py-10">
      <PageContainer className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-cobalt" />
              <h2 id="home-concern-title" className="m-0 font-display text-18 font-bold tracking-tight text-ink sm:text-20 lg:text-22">
                {m.homeConcernTitle}
              </h2>
            </div>
            <p className="m-0 text-13 font-medium text-stone lg:text-14">
              اختاري ما يهمك لنقدم لك أفضل المنتجات المناسبة لبشرتك وشعرك
            </p>
          </div>

          <Link
            href={routes.products}
            className="group inline-flex items-center gap-1.5 text-13 font-bold text-cobalt transition-colors hover:text-ink lg:text-14"
          >
            <span>عرض كل الاحتياجات</span>
            <Icon name="arrow-forward" size={14} className="transition-transform group-hover:translate-x-[-2px] rtl:group-hover:translate-x-[2px]" />
          </Link>
        </div>

        {/* Refined Horizontal Discovery Strip with Real Macro Photography */}
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
                      'group inline-flex h-13 items-center gap-3 rounded-full border border-line bg-chalk pe-5 ps-1.5 py-1 text-14 font-semibold text-ink shadow-outline-hairline transition-all duration-fast',
                      'hover:border-cobalt hover:bg-chalk hover:text-cobalt hover:shadow-e1 active:scale-95'
                    )}
                  >
                    <div className="relative size-10 overflow-hidden rounded-full border border-line bg-sand flex-none shadow-sm">
                      <Image
                        src={chip.image}
                        alt={label}
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
