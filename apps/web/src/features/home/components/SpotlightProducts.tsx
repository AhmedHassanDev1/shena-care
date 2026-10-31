'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, A11y, Keyboard } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';

import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { ProductCard, ProductCardSkeleton } from '@/features/catalog/components/ProductCard';
import { toCardModel } from '@/features/catalog/lib/card-model';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { useHomeProducts } from '../hooks/useHomeProducts';

/**
 * Modern Beauty Editorial: The Beauty Edit (Featured Products Single-Row Swiper)
 * Implements a high-performance, single-row interactive carousel using Swiper React.
 * Keeps normal vertical page scrolling intact while enabling smooth horizontal swipe/drag.
 */
export function SpotlightProducts() {
  const m = useMessages();
  const locale = useLocale();
  const { data, isPending, isError, refetch, isFetching } = useHomeProducts();
  const cards = (data?.items ?? []).map((p) => toCardModel(p, locale, m.sizeOr));

  const [mounted, setMounted] = useState(false);
  const [swiperRef, setSwiperRef] = useState<SwiperType | null>(null);
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <section aria-labelledby="home-products-title" className="py-12 lg:py-16">
      <PageContainer className="flex flex-col gap-8">
        {/* Editorial Section Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-cobalt" />
              <span className="font-serif italic text-14 text-stone">The Beauty Edit</span>
            </div>
            <h2 id="home-products-title" className="m-0 font-display text-24 font-black tracking-tight text-ink sm:text-28 lg:text-34">
              {m.homeProductsTitle}
            </h2>
            <p className="m-0 max-w-xl text-14 leading-22 text-stone lg:text-15 lg:leading-24">
              {m.homeProductsBody}
            </p>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-auto">
            <Link
              href={routes.products}
              className="group inline-flex items-center gap-1.5 font-serif italic text-14 font-bold text-cobalt transition-colors hover:text-ink"
            >
              <span>{m.homeProductsMore}</span>
              <Icon name="arrow-forward" size={16} className="transition-transform group-hover:translate-x-[-2px] rtl:group-hover:translate-x-[2px]" />
            </Link>

            {/* Desktop Navigation Arrows */}
            <div className="hidden sm:flex items-center gap-1.5 ps-2 border-s border-line">
              <button
                type="button"
                onClick={() => swiperRef?.slidePrev()}
                disabled={isBeginning}
                aria-label="السابق"
                className="flex size-9 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-sm transition-all hover:border-cobalt hover:text-cobalt active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Icon name="chevron-back" size={16} />
              </button>
              <button
                type="button"
                onClick={() => swiperRef?.slideNext()}
                disabled={isEnd}
                aria-label="التالي"
                className="flex size-9 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-sm transition-all hover:border-cobalt hover:text-cobalt active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Icon name="chevron-forward" size={16} />
              </button>
            </div>
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
          <ul aria-busy="true" className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:gap-5 lg:grid-cols-4 lg:gap-6">
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>
                <ProductCardSkeleton />
              </li>
            ))}
          </ul>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-card border border-line bg-linen p-8 text-center sm:p-12">
            <span className="flex size-12 items-center justify-center rounded-full bg-sand text-stone">
              <Icon name="sparkles" size={24} />
            </span>
            <div className="flex max-w-md flex-col gap-1.5">
              <h3 className="m-0 font-display text-18 font-bold text-ink">
                {m.homeProductsEmpty}
              </h3>
              <p className="m-0 text-13.5 leading-22 text-stone">
                يجري تجهيز باقة المستحضرات وتحديث المخزون للعلامات التجارية المعتمدة. يمكنك استعراض الكتالوج أو التصفح بحسب المجموعات.
              </p>
            </div>
            <Link
              href={routes.products}
              className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-pill bg-ink px-6 text-13.5 font-bold text-chalk shadow-e1 transition-colors hover:bg-cobalt"
            >
              <span>استكشاف الكتالوج العام</span>
              <Icon name="arrow-forward" size={16} />
            </Link>
          </div>
        ) : !mounted ? (
          /* SSR Placeholder to avoid hydration mismatch */
          <div className="flex gap-4 overflow-x-hidden">
            {cards.slice(0, 4).map((card, i) => (
              <div key={card.id} className="w-[78%] flex-none sm:w-[46%] lg:w-[23%]">
                <ProductCard product={card} priority={i < 2} />
              </div>
            ))}
          </div>
        ) : (
          /* Interactive Single-Row Swiper */
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
                  slidesPerView: 1.3,
                  spaceBetween: 14,
                },
                480: {
                  slidesPerView: 1.8,
                  spaceBetween: 16,
                },
                640: {
                  slidesPerView: 2.3,
                  spaceBetween: 18,
                },
                768: {
                  slidesPerView: 2.8,
                  spaceBetween: 20,
                },
                1024: {
                  slidesPerView: 3.5,
                  spaceBetween: 22,
                },
                1280: {
                  slidesPerView: 4,
                  spaceBetween: 24,
                },
              }}
            >
              {cards.map((card, i) => (
                <SwiperSlide key={card.id} className="h-auto">
                  <ProductCard product={card} priority={i < 2} />
                </SwiperSlide>
              ))}
            </Swiper>
          </div>
        )}
      </PageContainer>
    </section>
  );
}
