'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import type { RoutineCardModel } from '@/features/routine/types/routine.types';

export interface RoutineCardProps {
  routine: RoutineCardModel;
  className?: string;
  isMobileOnly?: boolean;
}

/**
 * Editorial Routine Card based on the approved Stitch design (project 9294589212687541881).
 * Supports dual-column split layout on desktop and stacked snap-carousel layout on mobile.
 */
export function RoutineCard({ routine, className = '', isMobileOnly = false }: RoutineCardProps) {
  return (
    <article
      className={`group relative flex overflow-hidden rounded-card border border-line bg-linen shadow-elevation-1 transition-all duration-base hover:-translate-y-0.5 hover:shadow-elevation-2 ${
        isMobileOnly
          ? 'w-[300px] shrink-0 snap-start flex-col'
          : 'flex-col md:min-w-[560px] md:flex-1 md:flex-row'
      } ${className}`}
    >
      {/* Photo Column / Header */}
      <div
        className={`relative overflow-hidden bg-sand/30 shrink-0 ${
          isMobileOnly
            ? 'h-[140px] w-full'
            : 'h-[160px] w-full md:h-auto md:min-h-[340px] md:w-[45%]'
        }`}
      >
        <Image
          src={routine.imageSrc}
          alt={routine.imageAlt}
          fill
          className="object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
          sizes={isMobileOnly ? '300px' : '(min-width: 1024px) 380px, (min-width: 768px) 50vw, 100vw'}
        />
        {/* Warm shadow gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/30 via-transparent to-transparent pointer-events-none" />

        {/* Category Pill (Top-Start) */}
        <div className="absolute top-3 end-3 z-10 flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded-pill border border-line bg-chalk/90 px-2.5 py-1 backdrop-blur-sm shadow-elevation-1">
            <span className="size-2 rounded-full bg-citron" />
            <span className="text-11 font-bold text-ink">{routine.categoryLabelAr}</span>
          </div>
        </div>

        {/* Mobile Frequency Badge (Top-End) */}
        <div className="absolute top-3 start-3 z-10 md:hidden">
          <span className="inline-flex items-center rounded-pill bg-tomato px-2.5 py-1 text-10.5 font-bold text-ink shadow-elevation-1">
            {routine.periodBadgeAr}
          </span>
        </div>

        {/* Steps Count Badge (Bottom-Start) */}
        <div className="absolute bottom-3 end-3 z-10 flex items-center gap-1 rounded-pill bg-ink/85 px-2.5 py-0.5 text-chalk backdrop-blur-sm shadow-elevation-1">
          <span className="font-serif italic text-12 text-citron">
            {routine.stepsCountMobileBadgeAr.slice(0, 2)}
          </span>
          <span className="text-10.5 font-medium">{routine.stepsCountBadgeAr}</span>
        </div>
      </div>

      {/* Content Column */}
      <div
        className={`relative z-10 flex flex-grow flex-col justify-between bg-linen ${
          isMobileOnly
            ? '-mt-2.5 rounded-t-card p-4 pt-3 pb-3.5 shadow-elevation-1'
            : 'p-5 md:w-[55%] md:p-6'
        }`}
      >
        <div>
          {/* Desktop Frequency Tag */}
          <div className="hidden md:flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-12 font-bold uppercase tracking-wider text-tomato">
              <span className="size-2 rounded-full bg-tomato inline-block" />
              {routine.periodLabelAr}
            </span>
          </div>

          {/* Routine Title */}
          <h3 className="font-display text-18 md:text-24 font-extrabold text-ink transition-colors duration-fast group-hover:text-cobalt leading-snug">
            {routine.titleAr}
          </h3>

          {/* Subtitle / Description */}
          <p className="mt-1.5 text-12 md:text-14 leading-relaxed text-stone line-clamp-2">
            {routine.subtitleAr}
          </p>

          {/* Care Journey Sequence */}
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 text-11 font-bold text-stone">رحلة العناية:</div>
            <div className="flex flex-wrap items-center gap-1.5 text-12 font-bold text-ink">
              {routine.steps.map((st, i) => (
                <React.Fragment key={st.stepNumber}>
                  {i > 0 && <span className="text-11 text-stone">←</span>}
                  <span className="inline-flex items-center gap-1 rounded-card bg-sand/60 px-2 py-0.5 text-cobalt font-display text-11">
                    <span className="font-serif italic font-extrabold">{st.stepNumber}</span>
                    <span>{st.labelAr}</span>
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <div className="mt-4 pt-1">
          <Link
            href={routine.detailHref}
            className="flex h-12 w-full items-center justify-between rounded-pill bg-cobalt px-5 font-display text-13 md:text-14 font-bold text-chalk shadow-elevation-1 transition-all duration-fast hover:bg-cobalt-deep hover:shadow-elevation-2 active:scale-[0.98]"
          >
            <span className="flex-grow text-center">اكتشف الروتين</span>
            <Icon
              name="arrow-forward"
              size={18}
              className="shrink-0 transition-transform duration-fast group-hover:-translate-x-1"
            />
          </Link>
        </div>
      </div>
    </article>
  );
}
