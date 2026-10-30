'use client';

import { Section, SectionHeader } from '@/components/layout/section';
import { ArrowLink } from '@/components/ui/arrow-link';
import { Button } from '@/components/ui/button';
import { MessageBox } from '@/components/ui/message-box';
import { ProductCard, ProductCardSkeleton } from '@/features/catalog/components/ProductCard';
import { toCardModel } from '@/features/catalog/lib/card-model';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { useHomeProducts } from '../hooks/useHomeProducts';
import { sectionNumber } from '../lib/section-number';

const gridClass = 'm-0 grid list-none grid-cols-2 gap-x-3 gap-y-8 p-0 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-10';

/**
 * Selected products (Stitch section 03): the shared ProductCard with the catalog's own packshots, two across on phones
 * and four from lg. A failed request shows the error with a retry; an empty answer shows an honest empty message.
 * Nothing is substituted for either.
 */
export function SpotlightProducts() {
  const m = useMessages();
  const locale = useLocale();
  const { data, isPending, isError, refetch, isFetching } = useHomeProducts();
  const cards = (data?.items ?? []).map((p) => toCardModel(p, locale, m.sizeOr));

  return (
    <Section labelledBy="home-products-title" band>
      <SectionHeader
        number={sectionNumber(3, locale)}
        title={m.homeProductsTitle}
        titleId="home-products-title"
        lead={m.homeProductsBody}
        aside={<ArrowLink href={routes.products}>{m.homeProductsMore}</ArrowLink>}
      />

      {isError ? (
        <MessageBox tone="err">
          <span className="flex flex-wrap items-center justify-between gap-3">
            {m.homeProductsError}
            <Button variant="light" size="s" loading={isFetching} onClick={() => refetch()}>
              {m.tryAgain}
            </Button>
          </span>
        </MessageBox>
      ) : isPending ? (
        <ul aria-busy="true" className={gridClass}>
          {[0, 1, 2, 3].map((i) => (
            <li key={i}>
              <ProductCardSkeleton />
            </li>
          ))}
        </ul>
      ) : cards.length === 0 ? (
        <MessageBox tone="info">{m.homeProductsEmpty}</MessageBox>
      ) : (
        <ul className={gridClass}>
          {cards.slice(0, 8).map((card, i) => (
            <li key={card.id} className={i > 3 ? 'max-lg:hidden' : undefined}>
              <ProductCard product={card} priority={i < 2} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
