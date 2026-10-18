'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { MessageBox } from '@/components/ui/message-box';
import { SectionHeader } from '@/components/ui/section-header';
import { discoverProducts } from '@/features/catalog/api/discovery';
import type { ProductView } from '@/features/catalog/api/products';
import { ProductCard, ProductCardSkeleton } from '@/features/catalog/components/ProductCard';
import { toCardModel } from '@/features/catalog/lib/card-model';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { PICKS_COUNT } from '../home-data';

type Filter = 'all' | 'skin' | 'hair';

/**
 * «مختارات الخريف» (Main / Mobile picks): eyebrow + Beiruti title, filter pills «الكل · البشرة · الشعر» and «شوف الكل»,
 * then the feature card (two columns on desktop, «اختيار الموسم» tag) and the shared product cards. The pills
 * re-query the discovery API by department; the cards are real sellable products.
 */
export function SeasonPicks({ initial }: { initial: ProductView[] }) {
  const m = useMessages();
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>('all');
  const category = filter === 'skin' ? mainCategorySlugs.skin : filter === 'hair' ? mainCategorySlugs.hair : undefined;
  const query = useQuery({
    queryKey: ['home', 'picks', category ?? 'all'],
    queryFn: () => discoverProducts(category ? { category } : {}, undefined, PICKS_COUNT).then((page) => page.items),
    initialData: filter === 'all' ? initial.slice(0, PICKS_COUNT) : undefined,
    staleTime: 60_000,
  });
  const cards = (query.data ?? []).slice(0, PICKS_COUNT).map((p) => toCardModel(p, locale, m.sizeOr));
  const [feature, ...rest] = cards;
  const pills: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: m.picksAll },
    { id: 'skin', label: m.navSkin },
    { id: 'hair', label: m.navHair },
  ];

  return (
    <section aria-labelledby="picks-h" aria-busy={query.isFetching || undefined}>
      <SectionHeader
        id="picks-h"
        eyebrow={m.picksEyebrow}
        title={<span className="font-display text-40 font-extrabold leading-45 max-lg:text-display-1">{m.picksTitle}</span>}
        link={{ href: routes.products, label: m.picksSeeAll }}
        aside={
          <div role="group" aria-label={m.picksTitle} className="order-last flex w-full flex-wrap gap-2 lg:order-none lg:w-auto">
            {pills.map((p) => (
              <Chip key={p.id} selected={filter === p.id} onClick={() => setFilter(p.id)}>
                {p.label}
              </Chip>
            ))}
          </div>
        }
        className="mb-5 lg:mb-7"
      />

      {query.isError ? (
        <MessageBox tone="err" className="items-center">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1">{m.picksError}</span>
            <Button variant="light" size="s" onClick={() => query.refetch()}>
              {m.picksRetry}
            </Button>
          </div>
        </MessageBox>
      ) : query.isPending ? (
        <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-8 p-0 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-12">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i}>
              <ProductCardSkeleton />
            </li>
          ))}
        </ul>
      ) : !feature ? (
        <MessageBox tone="info">{m.picksEmpty}</MessageBox>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-8 p-0 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-12">
          <li className={cn('col-span-2 flex', 'relative')}>
            <div className="relative w-full">
              <span className="absolute start-3.5 top-3.5 z-10 inline-flex h-7 items-center rounded-pill bg-linen px-3 text-12 font-semibold leading-17 text-night shadow-elevation-1">
                {m.picksFeature}
              </span>
              <ProductCard product={feature} priority feature />
            </div>
          </li>
          {rest.map((product, index) => (
            <li key={product.id} className="flex">
              <ProductCard product={product} priority={index < 2} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
