'use client';

import * as React from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { routes } from '@/lib/routes';
import { useFeaturedRoutines } from '@/features/routine/hooks/useRoutines';
import { RoutineCard } from './RoutineCard';

/**
 * Approved Routine Discovery Section from Stitch (project 9294589212687541881).
 * Features authentic care routines with dual-column layout on desktop, snap-carousel
 * on mobile, directional RTL navigation, and SAHEL design system tokens.
 */
export function RoutineSection() {
  const { data: routines = [], isLoading } = useFeaturedRoutines();
  const carouselRef = React.useRef<HTMLDivElement>(null);

  const scrollRtl = React.useCallback((direction: 'next' | 'prev') => {
    if (!carouselRef.current) return;
    // In RTL, scrollLeft is negative or decreasing when advancing forward (to the left)
    const step = 580;
    const scrollAmount = direction === 'next' ? -step : step;
    carouselRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  }, []);

  return (
    <section
      id="routines"
      aria-labelledby="home-routine-title"
      className="w-full bg-chalk py-4 md:py-5 lg:py-6"
    >
      <PageContainer>
        {/* Editorial Section Header */}
        <div className="mb-4 md:mb-5 lg:mb-6">
          {/* Mobile top strip: Eyebrow + All routines link */}
          <div className="flex items-center justify-between md:hidden mb-2">
            <div className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-sand/40 px-2.5 py-1">
              <span className="size-2 rounded-full bg-citron" />
              <span className="font-serif italic text-11 uppercase tracking-wider text-stone">
                ROUTINES / THE CARE EDIT
              </span>
            </div>
            <Link
              href={routes.routines}
              className="inline-flex items-center gap-1 text-12 font-bold text-cobalt hover:underline"
            >
              <span>كل الروتينات</span>
              <Icon name="arrow-forward" size={14} />
            </Link>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              {/* Desktop Eyebrow */}
              <div className="hidden md:inline-flex items-center gap-2 mb-2 rounded-pill border border-line bg-sand/40 px-3 py-1">
                <span className="size-2 rounded-full bg-citron" />
                <span className="font-serif italic text-11 font-bold uppercase tracking-widest text-ink">
                  ROUTINES / THE CARE EDIT
                </span>
              </div>

              {/* Main Heading */}
              <h2
                id="home-routine-title"
                className="font-display text-24 md:text-34 font-extrabold tracking-tight text-ink leading-tight"
              >
                روتينات <span className="text-cobalt">جاهزة</span> ليك.
              </h2>

              {/* Subtitle */}
              <p className="mt-1 text-13 md:text-15 text-stone leading-relaxed">
                <span className="hidden md:inline">
                  خطوات عناية مرتبة ومفصلة لشمس ورطوبة الساحل وبحر المتوسط.
                </span>
                <span className="md:hidden">خطوات عناية مرتبة لبشرتك وشعرك.</span>
              </p>
            </div>

            {/* Desktop Controls: Prev/Next Buttons + View All Button */}
            <div className="hidden md:flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-pill border border-line bg-sand/30 p-1">
                <button
                  type="button"
                  aria-label="السابق"
                  onClick={() => scrollRtl('prev')}
                  className="flex size-8 items-center justify-center rounded-full bg-chalk text-ink shadow-elevation-1 transition-all duration-fast hover:bg-cobalt hover:text-chalk active:scale-95"
                >
                  <Icon name="chevron-back" size={16} />
                </button>
                <button
                  type="button"
                  aria-label="التالي"
                  onClick={() => scrollRtl('next')}
                  className="flex size-8 items-center justify-center rounded-full bg-chalk text-ink shadow-elevation-1 transition-all duration-fast hover:bg-cobalt hover:text-chalk active:scale-95"
                >
                  <Icon name="chevron-forward" size={16} />
                </button>
              </div>

              <Link
                href={routes.routines}
                className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-chalk px-4 py-2 font-display text-13 font-bold text-cobalt shadow-elevation-1 transition-all duration-fast hover:bg-cobalt hover:text-chalk"
              >
                <span>كل الروتينات</span>
                <Icon name="arrow-forward" size={16} />
              </Link>
            </div>
          </div>
        </div>

        {/* Loading Skeleton */}
        {isLoading && routines.length === 0 && (
          <div className="flex gap-2 sm:gap-3 lg:gap-4 overflow-hidden">
            {[1, 2].map((k) => (
              <Skeleton
                key={k}
                className="h-[360px] flex-1 rounded-card border border-line"
              />
            ))}
          </div>
        )}

        {/* Empty State (when production API has no published routines) */}
        {!isLoading && routines.length === 0 && (
          <div className="rounded-card border border-line bg-linen p-8 text-center">
            <p className="font-display text-16 font-bold text-ink">لا توجد روتينات منشورة حالياً.</p>
            <p className="mt-1 text-13 text-stone">تابعنا قريباً لاستكشاف بروتوكولات العناية المعتمدة.</p>
          </div>
        )}

        {/* Cards Presentation */}
        {routines.length > 0 && (
          <>
            {/* Desktop Carousel / Dual Column Display */}
            <div
              ref={carouselRef}
              className="hidden md:flex gap-3 lg:gap-4 overflow-x-auto no-scrollbar scroll-smooth pb-1"
            >
              {routines.map((routine) => (
                <RoutineCard key={routine.id} routine={routine} />
              ))}
            </div>

            {/* Mobile Horizontal Snap-Carousel with card peek */}
            <div className="flex md:hidden gap-2 sm:gap-3 overflow-x-auto no-scrollbar -mx-4 md:-mx-6 px-4 md:px-6 pb-1 snap-x snap-mandatory scroll-smooth">
              {routines.map((routine) => (
                <RoutineCard key={routine.id} routine={routine} isMobileOnly />
              ))}
            </div>
          </>
        )}
      </PageContainer>
    </section>
  );
}
