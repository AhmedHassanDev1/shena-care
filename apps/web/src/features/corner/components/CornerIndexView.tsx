'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Section, SectionHeader } from '@/components/layout/section';
import { ArrowLink } from '@/components/ui/arrow-link';
import { Button } from '@/components/ui/button';
import { ChipLink } from '@/components/ui/chip-link';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { ProductTile } from '@/components/ui/product-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { getConcernShelf, productTypeLabel, type ConcernShelfEntry } from '@/features/care/api/care-intelligence';
import { concernPhoto } from '../lib/concern-photo';

/**
 * The Corner: discovery that starts from what the customer wants to care for. Only concerns the catalog can serve
 * today are shown (a concern with no orderable product is hidden, never greyed out); each tile says how many products
 * fit and which kinds, so the concern reads as a small routine rather than a bag of products.
 */
export function CornerIndexView() {
  const m = useMessages();
  const locale = useLocale();
  const shelf = useQuery({ queryKey: ['guidance', 'concerns'], queryFn: getConcernShelf, staleTime: 2 * 60 * 1000 });
  const visible = (shelf.data ?? []).filter((c) => c.productCount > 0 || c.heldForSafety);
  const groups: Array<{ area: 'skin' | 'hair'; label: string }> = [
    { area: 'skin', label: m.cornerSkin },
    { area: 'hair', label: m.cornerHair },
  ];

  return (
    <>
      <Section labelledBy="corner-title" rhythm="tight">
        <div className="flex flex-col gap-2">
          <span className="font-display text-12 font-semibold uppercase tracking-wider text-stone">{m.cornerEyebrow}</span>
          <h1 id="corner-title" className="m-0 font-display text-30 font-extrabold tracking-tight text-ink lg:text-34">
            {m.cornerTitle}
          </h1>
          <p className="m-0 max-w-narrow text-body text-stone">{m.cornerLead}</p>
        </div>
      </Section>

      {shelf.isPending ? (
        <Section labelledBy="corner-loading" rhythm="tight">
          <span id="corner-loading" className="sr-only">{m.loading}</span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32 rounded-card" />)}
          </div>
        </Section>
      ) : shelf.isError ? (
        <Section labelledBy="corner-error" rhythm="tight">
          <MessageBox tone="err" title={<span id="corner-error">{m.cornerLoadError}</span>}>
            <Button variant="ghost" size="s" onClick={() => shelf.refetch()}>{m.tryAgain}</Button>
          </MessageBox>
        </Section>
      ) : visible.length === 0 ? (
        <Section labelledBy="corner-empty" rhythm="tight">
          <MessageBox tone="info" title={<span id="corner-empty">{m.cornerEmpty}</span>}>
            <ArrowLink href={routes.products}>{m.homeNavProducts}</ArrowLink>
          </MessageBox>
        </Section>
      ) : (
        groups.map(({ area, label }) => {
          const concerns = visible.filter((c) => c.careArea === area).sort((a, b) => b.productCount - a.productCount);
          if (!concerns.length) return null;
          const titleId = `corner-${area}`;
          return (
            <Section key={area} labelledBy={titleId} rhythm="tight">
              <SectionHeader
                title={label}
                titleId={titleId}
                aside={
                  <ArrowLink href={routes.productsByCategory(area === 'skin' ? mainCategorySlugs.skin : mainCategorySlugs.hair)}>
                    {m.cornerByCategory}
                  </ArrowLink>
                }
              />
              <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
                {concerns.map((concern) => (
                  <li key={concern.slug}>
                    <ConcernTile concern={concern} locale={locale} />
                  </li>
                ))}
              </ul>
            </Section>
          );
        })
      )}

      <Section labelledBy="corner-shina" band rhythm="tight">
        <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
          <div className="flex flex-col gap-1">
            <h2 id="corner-shina" className="m-0 font-display text-22 font-bold text-ink">{m.cornerAskShinaTitle}</h2>
            <p className="m-0 max-w-narrow text-body text-stone">{m.cornerAskShinaLead}</p>
          </div>
          <ChipLink href={routes.shinaFor({})} icon="sparkles">{m.cornerAskShina}</ChipLink>
        </div>
      </Section>
    </>
  );
}

function ConcernTile({ concern, locale }: { concern: ConcernShelfEntry; locale: 'ar' | 'en' }) {
  const m = useMessages();
  const photo = concernPhoto(concern);
  const types = concern.productTypes.slice(0, 4).map((type) => productTypeLabel(type, locale)).join(locale === 'ar' ? ' · ' : ' · ');
  return (
    <Link
      href={routes.cornerConcern(concern.slug)}
      className="group flex h-full items-stretch gap-3 rounded-card border border-line bg-linen p-3 text-start no-underline shadow-elevation-1 transition-transform duration-base hover:-translate-y-0.5 hover:shadow-elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="relative w-28 shrink-0 overflow-hidden rounded-image bg-sand/30 sm:w-32">
        {photo ? (
          <Image src={photo} alt="" fill sizes="128px" className="object-cover" />
        ) : (
          <ProductTile src={concern.leadImageUrl} alt="" name={concern.name} sizes="128px" className="h-full" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 font-display text-18 font-bold leading-tight text-ink group-hover:text-cobalt">{concern.name}</h3>
          {types ? <p className="m-0 text-12.5 text-stone">{types}</p> : null}
        </div>
        <div className="flex items-center justify-between gap-2 text-12.5">
          <span className="font-semibold text-ink">
            {concern.productCount > 0
              ? fillMessage(m.cornerProductCount, { n: formatNumber(concern.productCount, locale) })
              : m.cornerHeldNote}
          </span>
          <Icon name="arrow-forward" size={18} className="text-stone transition-transform group-hover:text-cobalt" />
        </div>
      </div>
    </Link>
  );
}
