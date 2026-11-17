'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { EASE_STANDARD, Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { ProductTile } from '@/components/ui/product-tile';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getRecommendations,
  type ConcernShelfEntry,
  type RecommendationRequest,
  type RecommendedItem,
} from '@/features/care/api/care-intelligence';
import { concernPhoto } from '@/features/corner/lib/concern-photo';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatAmount, formatNumber } from '@/lib/i18n/format';
import { fillMessage, type Locale, type Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useConcernShelf } from '../hooks/useConcernShelf';

const PREVIEW_LIMIT = 3;

function previewRequest(concern: ConcernShelfEntry, locale: Locale): RecommendationRequest {
  return { careArea: concern.careArea, concerns: [concern.slug], limit: PREVIEW_LIMIT, locale };
}

function countLabel(m: Messages, n: number, locale: Locale) {
  return n === 1 ? m.vxProductOne : fillMessage(m.vxProductsCount, { n: formatNumber(n, locale) });
}

/**
 * Shop by concern, as one stage instead of a grid of boxes. The list on the start side is the live concern shelf
 * (what the catalog can serve today); choosing a concern swaps the photograph and the three catalog products the
 * recommendation engine ranks first for it. Hovering or focusing a concern warms the next stage so the swap is
 * immediate. Every product, price and photo comes from the API; a concern with no registered photograph shows its
 * lead catalog packshot instead and never a drawn picture.
 */
export function ConcernShelf() {
  const m = useMessages();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const shelf = useConcernShelf();
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const concerns = shelf.concerns;
  const initial = [...concerns].sort((a, b) => b.productCount - a.productCount)[0]?.slug ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const activeSlug = picked && concerns.some((c) => c.slug === picked) ? picked : initial;
  const active = concerns.find((c) => c.slug === activeSlug) ?? null;

  // On phones the list scrolls sideways: keep the chosen concern centred in view (scrolls the list only, never the page).
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeSlug || window.innerWidth >= 1024) return;
    const tab = list.querySelector<HTMLElement>(`[data-slug="${activeSlug}"]`);
    if (!tab) return;
    const delta = tab.getBoundingClientRect().left + tab.offsetWidth / 2 - (list.getBoundingClientRect().left + list.clientWidth / 2);
    list.scrollBy({ left: delta, behavior: 'smooth' });
  }, [activeSlug]);

  const warm = useCallback(
    (concern: ConcernShelfEntry) => {
      const request = previewRequest(concern, locale);
      void queryClient.prefetchQuery({
        queryKey: ['home', 'concern-preview', concern.slug, locale],
        queryFn: ({ signal }) => getRecommendations(request, signal),
        staleTime: 60_000,
      });
    },
    [locale, queryClient],
  );

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = ['ArrowDown', locale === 'ar' ? 'ArrowLeft' : 'ArrowRight'];
    const prev = ['ArrowUp', locale === 'ar' ? 'ArrowRight' : 'ArrowLeft'];
    const step = next.includes(event.key) ? 1 : prev.includes(event.key) ? -1 : 0;
    if (!step || concerns.length === 0) return;
    event.preventDefault();
    const index = concerns.findIndex((c) => c.slug === activeSlug);
    const target = concerns[(index + step + concerns.length) % concerns.length];
    setPicked(target.slug);
    listRef.current?.querySelector<HTMLElement>(`[data-slug="${target.slug}"]`)?.focus();
  };

  return (
    <section id="shop" aria-labelledby="home-concern-title" className="scroll-mt-16 bg-chalk py-8 lg:py-14">
      <PageContainer className="flex flex-col gap-6 lg:gap-8">
        <Reveal className="flex max-w-2xl flex-col gap-2">
          <h2 id="home-concern-title" className="m-0 font-display text-display-1 font-extrabold tracking-tight text-ink">
            {m.homeConcernTitle}
          </h2>
          <p className="m-0 text-body text-stone">{m.vxAtlasLead}</p>
        </Reveal>

        {shelf.isPending ? (
          <div className="grid gap-4 lg:grid-cols-12 lg:gap-8" aria-busy="true">
            <div className="flex gap-2 lg:col-span-5 lg:flex-col">
              {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-40 shrink-0 rounded-card lg:h-14 lg:w-full" />)}
            </div>
            <Skeleton className="h-96 rounded-sheet lg:col-span-7" />
          </div>
        ) : shelf.isError ? (
          <MessageBox tone="err" title={m.concernLoadError}>
            <Button variant="ghost" size="s" onClick={() => void shelf.refetch()}>{m.tryAgain}</Button>
          </MessageBox>
        ) : concerns.length === 0 || !active ? (
          <MessageBox tone="info" title={m.cornerEmpty} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-12 lg:gap-10">
            {/* Concern list: tabs. Horizontal and swipeable on phones, a vertical index on desktop. */}
            <div className="min-w-0 lg:col-span-5">
              <div
                ref={listRef}
                role="tablist"
                aria-label={m.vxAtlasListLabel}
                aria-orientation="vertical"
                onKeyDown={move}
                className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 no-scrollbar md:-mx-6 md:px-6 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0"
              >
                {concerns.map((concern) => {
                  const selected = concern.slug === activeSlug;
                  return (
                    <button
                      key={concern.slug}
                      id={`${baseId}-tab-${concern.slug}`}
                      data-slug={concern.slug}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`${baseId}-panel`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setPicked(concern.slug)}
                      onMouseEnter={() => warm(concern)}
                      onFocus={() => warm(concern)}
                      className={cn(
                        'group relative flex shrink-0 cursor-pointer items-center gap-3 rounded-pill border px-4 py-2.5 text-start transition-colors duration-fast',
                        'lg:w-full lg:justify-between lg:rounded-none lg:border-0 lg:border-b lg:border-line lg:bg-transparent lg:px-0 lg:py-3.5',
                        selected
                          ? 'border-ink bg-ink text-chalk lg:text-ink'
                          : 'border-line-2 bg-linen text-ink hover:border-ink lg:text-stone lg:hover:text-ink',
                      )}
                    >
                      {selected ? (
                        <motion.span
                          layoutId={`${baseId}-marker`}
                          aria-hidden="true"
                          className="absolute inset-y-2 -start-3 hidden w-1 rounded-pill bg-cobalt lg:block"
                          transition={{ type: 'spring', visualDuration: 0.35, bounce: 0.15 }}
                        />
                      ) : null}
                      <span className="font-display text-17 font-bold lg:text-26 lg:leading-34">{concern.name}</span>
                      <span className={cn('text-13 font-medium tabular-nums', selected ? 'text-chalk/80 lg:text-stone' : 'text-stone')}>
                        {countLabel(m, concern.productCount, locale)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Stage: photograph + the products the engine ranks first for the chosen concern. */}
            <div
              id={`${baseId}-panel`}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${active.slug}`}
              className="flex min-w-0 flex-col gap-4 lg:col-span-7"
            >
              <ConcernPhotoStage concern={active} />
              <ConcernPreview concern={active} />
              <Link
                href={routes.cornerConcern(active.slug)}
                className="inline-flex h-control-m items-center gap-2 self-start font-display text-16 font-bold text-cobalt lg:hidden"
              >
                <span>{fillMessage(m.vxAtlasOpen, { name: active.name })}</span>
                <Icon name="arrow-forward" size={16} strokeWidth={2.2} />
              </Link>
            </div>
          </div>
        )}
      </PageContainer>
    </section>
  );
}

function ConcernPhotoStage({ concern }: { concern: ConcernShelfEntry }) {
  const m = useMessages();
  const photo = concernPhoto(concern);
  const alt = fillMessage(m.vxAtlasPhotoAlt, { name: concern.name });

  return (
    <div className="relative hidden aspect-[16/10] w-full overflow-hidden rounded-sheet bg-sand lg:block">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={concern.slug}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: EASE_STANDARD }}
        >
          {photo ? (
            <Image src={photo} alt={alt} fill sizes="(min-width: 1024px) 700px, 100vw" className="object-cover" />
          ) : (
            <ProductTile
              src={concern.leadImageUrl}
              alt={alt}
              name={concern.name}
              fit="contain"
              sizes="(min-width: 1024px) 700px, 100vw"
              className="size-full rounded-none bg-sand"
              imageClassName="p-6"
            />
          )}
        </motion.div>
      </AnimatePresence>

      <Link
        href={routes.cornerConcern(concern.slug)}
        className="absolute bottom-3 end-3 z-10 inline-flex h-control-m items-center gap-2 rounded-pill bg-linen px-5 font-display text-15 font-bold text-ink shadow-elevation-2 transition-[background-color,color] duration-fast hover:bg-cobalt hover:text-chalk"
      >
        <span>{fillMessage(m.vxAtlasOpen, { name: concern.name })}</span>
        <Icon name="arrow-forward" size={16} strokeWidth={2.2} />
      </Link>
    </div>
  );
}

function ConcernPreview({ concern }: { concern: ConcernShelfEntry }) {
  const m = useMessages();
  const locale = useLocale();
  const request = previewRequest(concern, locale);
  const recs = useQuery({
    queryKey: ['home', 'concern-preview', concern.slug, locale],
    queryFn: ({ signal }) => getRecommendations(request, signal),
    staleTime: 60_000,
  });
  const items = recs.data?.items ?? [];

  if (recs.isPending) {
    return (
      <div className="grid grid-cols-3 gap-3" aria-busy="true">
        {Array.from({ length: PREVIEW_LIMIT }, (_, i) => <Skeleton key={i} className="h-44 rounded-card" />)}
      </div>
    );
  }
  if (recs.isError) {
    return (
      <MessageBox tone="err" title={m.concernLoadError}>
        <Button variant="ghost" size="s" onClick={() => void recs.refetch()}>{m.tryAgain}</Button>
      </MessageBox>
    );
  }
  if (items.length === 0) {
    return <MessageBox tone="info" title={concern.heldForSafety ? m.vxAtlasHeld : m.vxAtlasNoProducts} />;
  }

  return (
    <motion.ul
      key={concern.slug}
      className="m-0 grid list-none grid-cols-3 gap-3 p-0"
      initial="hidden"
      animate="shown"
      transition={{ staggerChildren: 0.07 }}
    >
      {items.map((item) => (
        <motion.li
          key={item.skuId}
          variants={{ hidden: { opacity: 0, y: 14 }, shown: { opacity: 1, y: 0 } }}
          transition={{ duration: 0.45, ease: EASE_STANDARD }}
          className="min-w-0"
        >
          <PreviewProduct item={item} />
        </motion.li>
      ))}
    </motion.ul>
  );
}

function PreviewProduct({ item }: { item: RecommendedItem }) {
  const m = useMessages();
  const locale = useLocale();
  return (
    <Link
      href={routes.product(item.slug)}
      className="group/card flex h-full flex-col gap-2"
    >
      <ProductTile
        src={item.imageUrl}
        alt={item.name}
        name={item.name}
        sizes="(min-width: 1024px) 220px, 30vw"
        className="rounded-image"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-12 font-medium text-stone"><bdi>{item.brand}</bdi></span>
        <span className="line-clamp-2 font-display text-14 font-bold leading-20 text-ink lg:text-15"><bdi>{item.name}</bdi></span>
      </div>
      <span className="font-display text-15 font-bold text-ink tabular-nums">
        {formatAmount(item.price.amount, locale)} <span className="text-12 font-semibold text-stone">{m.pdpCurrencyEgp}</span>
      </span>
    </Link>
  );
}
