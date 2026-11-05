'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, A11y, Keyboard } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';

import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { toCardModel } from '@/features/catalog/lib/card-model';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useHomeProducts } from '../hooks/useHomeProducts';
import { ShowcaseProductCard, ShowcaseProductCardSkeleton } from './ShowcaseProductCard';

type FilterCategory = 'all' | 'sun' | 'serum' | 'moisturizer' | 'hair';

/**
 * Creative Product Showcase: The Sahel Beauty Edit
 * Redesigned from the approved Stitch project (8441884584643557256):
 * - Architectural Atelier eyebrow with pulsing citron sun accent
 * - Curated solution-based discovery filter pills (All, Sun Care, Serums, Moisturizers, Hair Care)
 * - Single-row responsive carousel with mobile peek (1.25 slides per view for intuitive swipe)
 * - Elevated 4:5 editorial cards with authentic packshots, real pricing, and Cobalt CTAs
 * - Integrated Coastal Express delivery and authenticity assurance strip bridging into categories
 */
export function SpotlightProducts() {
  const m = useMessages();
  const locale = useLocale();
  const { data, isPending, isError, refetch, isFetching } = useHomeProducts();

  const [mounted, setMounted] = useState(false);
  const [swiperRef, setSwiperRef] = useState<SwiperType | null>(null);
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');

  useEffect(() => {
    setMounted(true);
  }, []);

  const allCards = useMemo(() => {
    return (data?.items ?? []).map((p) => toCardModel(p, locale, m.sizeOr));
  }, [data?.items, locale, m.sizeOr]);

  // Client-side solution filtering for instant, zero-latency feedback
  const filteredCards = useMemo(() => {
    if (activeFilter === 'all') return allCards;

    return allCards.filter((card) => {
      const type = (card.type ?? '').toLowerCase();
      const name = card.name.toLowerCase();
      const slug = card.slug.toLowerCase();
      const line = (card.productLine ?? '').toLowerCase();

      switch (activeFilter) {
        case 'sun':
          return (
            type.includes('شمس') ||
            name.includes('شمس') ||
            slug.includes('spf') ||
            slug.includes('sun') ||
            line.includes('solar')
          );
        case 'serum':
          return (
            type.includes('سيرم') ||
            name.includes('سيروم') ||
            slug.includes('serum') ||
            slug.includes('srm') ||
            line.includes('radiance')
          );
        case 'moisturizer':
          return (
            type.includes('مرطب') ||
            name.includes('كريم') ||
            slug.includes('cream') ||
            slug.includes('repair') ||
            line.includes('barrier')
          );
        case 'hair':
          return (
            type.includes('شعر') ||
            type.includes('شامبو') ||
            type.includes('بلسم') ||
            name.includes('شعر') ||
            slug.includes('hair') ||
            slug.includes('frizz') ||
            line.includes('hair')
          );
        default:
          return true;
      }
    });
  }, [allCards, activeFilter]);

  const cardsToRender = filteredCards.length > 0 ? filteredCards : allCards;

  // Whenever filter changes, reset swiper to first slide
  const handleFilterChange = (filter: FilterCategory) => {
    setActiveFilter(filter);
    if (swiperRef && !swiperRef.destroyed) {
      swiperRef.slideTo(0);
    }
  };

  const filterTabs: Array<{ id: FilterCategory; label: string; count?: number }> = [
    { id: 'all', label: m.homeProductsFilterAll, count: allCards.length },
    { id: 'sun', label: m.homeProductsFilterSun },
    { id: 'serum', label: m.homeProductsFilterSerums },
    { id: 'moisturizer', label: m.homeProductsFilterMoisturizers },
    { id: 'hair', label: m.homeProductsFilterHair },
  ];

  return (
    <section aria-labelledby="home-products-title" className="py-12 lg:py-20">
      <PageContainer className="flex flex-col gap-8">
        {/* Editorial Section Header */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="flex max-w-2xl flex-col gap-2">
              {/* Atelier Eyebrow with Pulsing Citron Sun Dot */}
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-citron ring-2 ring-citron/30" />
                <span className="text-11 font-bold uppercase tracking-wider text-stone">
                  {m.homeProductsEyebrow}
                </span>
              </div>

              {/* Architectural Main Title */}
              <h2
                id="home-products-title"
                className="m-0 font-display text-28 font-extrabold tracking-tight text-ink sm:text-32 lg:text-34"
              >
                {m.homeProductsTitle}
              </h2>

              {/* Editorial Subtitle */}
              <p className="m-0 text-14 leading-22 text-stone lg:text-15 lg:leading-24">
                {m.homeProductsBody}
              </p>
            </div>

            {/* Header Controls (Explore All & Desktop Navigation) */}
            <div className="flex items-center gap-3 self-start md:self-end">
              <Link
                href={routes.products}
                className="link-quiet inline-flex items-center gap-1.5 text-14 font-bold text-ink transition-colors hover:text-cobalt"
              >
                <span>{m.homeProductsMore}</span>
                <Icon name="arrow-forward" size={16} />
              </Link>

              {/* Desktop Round Navigation Controls */}
              <div className="hidden items-center gap-2 border-s border-line ps-3 sm:flex">
                <button
                  type="button"
                  onClick={() => swiperRef?.slidePrev()}
                  disabled={isBeginning}
                  aria-label={m.carouselPrev}
                  className="flex size-10 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-elevation-1 transition-all hover:border-cobalt hover:text-cobalt active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Icon name="chevron-back" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => swiperRef?.slideNext()}
                  disabled={isEnd}
                  aria-label={m.carouselNext}
                  className="flex size-10 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-elevation-1 transition-all hover:border-cobalt hover:text-cobalt active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Icon name="chevron-forward" size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Curated Discovery Filter Pills (Solution-Driven) */}
          <div
            role="tablist"
            aria-label={m.homeProductsTitle}
            className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1"
          >
            {filterTabs.map((tab) => {
              const active = activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleFilterChange(tab.id)}
                  type="button"
                  className={cn(
                    'inline-flex flex-none items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-12 font-bold transition-all duration-fast',
                    active
                      ? 'bg-cobalt text-chalk shadow-elevation-1'
                      : 'border border-line/70 bg-linen/80 text-ink hover:border-line hover:bg-chalk'
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined ? (
                    <span
                      className={cn(
                        'ms-1 inline-flex items-center rounded-pill px-1.5 text-11 tabular-nums',
                        active ? 'bg-chalk/20 text-chalk' : 'bg-sand/40 text-stone'
                      )}
                    >
                      {tab.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content States */}
        {isError ? (
          <MessageBox tone="err">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>{m.homeProductsError}</span>
              <Button variant="linen" size="s" loading={isFetching} onClick={() => refetch()}>
                {m.tryAgain}
              </Button>
            </span>
          </MessageBox>
        ) : isPending ? (
          <ul
            aria-busy="true"
            className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6"
          >
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>
                <ShowcaseProductCardSkeleton />
              </li>
            ))}
          </ul>
        ) : cardsToRender.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-card border border-line bg-linen p-8 text-center sm:p-12">
            <span className="flex size-12 items-center justify-center rounded-full bg-sand text-stone">
              <Icon name="sparkles" size={24} />
            </span>
            <div className="flex max-w-md flex-col gap-1.5">
              <h3 className="m-0 font-display text-18 font-bold text-ink">
                {m.homeProductsEmpty}
              </h3>
              <p className="m-0 text-14 leading-22 text-stone">{m.homeProductsEmptyBody}</p>
            </div>
            <Link
              href={routes.products}
              className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-pill bg-ink px-6 text-14 font-bold text-chalk shadow-elevation-1 transition-colors hover:bg-cobalt"
            >
              <span>{m.homeProductsBrowse}</span>
              <Icon name="arrow-forward" size={16} />
            </Link>
          </div>
        ) : !mounted ? (
          /* SSR Placeholder to avoid hydration mismatch */
          <div className="flex gap-4 overflow-x-hidden">
            {cardsToRender.slice(0, 4).map((card, i) => (
              <div key={card.id} className="w-[78%] flex-none sm:w-[46%] lg:w-[23%]">
                <ShowcaseProductCard product={card} priority={i < 2} />
              </div>
            ))}
          </div>
        ) : (
          /* Single-Row Interactive Swiper with mobile peek */
          <div className="w-full">
            <Swiper
              modules={[Navigation, A11y, Keyboard]}
              onSwiper={(swiper) => {
                setSwiperRef(swiper);
                setIsBeginning(swiper.isBeginning);
                setIsEnd(swiper.isEnd);
              }}
              onSlideChange={(swiper) => {
                setIsBeginning(swiper.isBeginning);
                setIsEnd(swiper.isEnd);
              }}
              dir={locale === 'ar' ? 'rtl' : 'ltr'}
              grabCursor={true}
              watchOverflow={true}
              keyboard={{ enabled: true }}
              className="w-full !overflow-visible sm:!overflow-hidden"
              breakpoints={{
                320: {
                  slidesPerView: 1.25,
                  spaceBetween: 14,
                },
                480: {
                  slidesPerView: 1.6,
                  spaceBetween: 16,
                },
                640: {
                  slidesPerView: 2.25,
                  spaceBetween: 18,
                },
                768: {
                  slidesPerView: 2.75,
                  spaceBetween: 20,
                },
                1024: {
                  slidesPerView: 3.4,
                  spaceBetween: 22,
                },
                1280: {
                  slidesPerView: 4,
                  spaceBetween: 24,
                },
              }}
            >
              {cardsToRender.map((card, i) => (
                <SwiperSlide key={card.id} className="h-auto">
                  <ShowcaseProductCard product={card} priority={i < 2} />
                </SwiperSlide>
              ))}
            </Swiper>
          </div>
        )}

        {/* Architectural Trust & Express Coastal Delivery Reassurance Strip */}
        <div className="mt-4 flex flex-col items-center justify-between gap-4 rounded-card border border-line/60 bg-linen/90 p-5 shadow-outline-hairline backdrop-blur-md md:flex-row md:p-6">
          <div className="flex items-center gap-3.5">
            <div className="flex size-11 flex-none items-center justify-center rounded-full bg-sand/40 text-cobalt">
              <Icon name="truck" size={22} />
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="m-0 text-15 font-bold text-ink">
                {m.homeProductsTrustTitle}
              </p>
              <p className="m-0 text-13 leading-18 text-stone">
                {m.homeProductsTrustBody}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 self-stretch border-t border-line/40 pt-3 md:self-auto md:border-t-0 md:pt-0">
            <div className="flex items-center gap-2">
              <Icon name="science" size={18} className="text-cobalt" />
              <span className="text-12 font-bold text-ink">
                {m.homeProductsTrustClinicallyTested}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Icon name="shield" size={18} className="text-cobalt" />
              <span className="text-12 font-bold text-ink">
                {m.homeProductsTrustAuthentic}
              </span>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
