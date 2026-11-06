'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Section } from '@/components/layout/section';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { mainCategorySlugs, routes } from '@/lib/routes';

/**
 * CategoryEditorial — Approved ShinaCare Sahel Category Showcase.
 *
 * Visual fidelity from Stitch project 15850160123086413494:
 * - Asymmetric 2-Card Layout (Desktop 1024px+):
 *   1. Skincare (67% width, leading / right in RTL):
 *      - Natural photographic spread on the right half.
 *      - Sunlit tomato slatted shutter panel on the left half with hydration badge,
 *        prominent editorial typography, and solid ink pill CTA.
 *   2. Haircare (33% width, trailing / left in RTL):
 *      - Natural photographic spread on the top (52%).
 *      - Sunlit cobalt slatted shutter panel on the bottom (48%) with
 *        crisp typography and chalk-outlined pill CTA.
 * - Mobile-first responsive hierarchy:
 *   - Stacks cleanly on phones (< 768px) with generous image viewports,
 *     responsive typography, and full-width pill targets that never wrap.
 *   - Seamless side-by-side split on tablets (768px+) and asymmetric layout on desktop.
 * - Adheres 100% to SAHEL Design System tokens (0 raw hex, 0 unapproved utilities,
 *   RTL logical directional behavior, and accessible semantics).
 */
export function CategoryEditorial() {
  const m = useMessages();

  return (
    <Section id="categories" labelledBy="home-categories-heading" className="overflow-hidden">
      {/* Section Header */}
      <div className="flex flex-col gap-2">
        <div className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-citron shadow-outline-hairline" aria-hidden="true" />
          <span className="font-display text-14 font-semibold text-ink/80">{m.homeCategoriesEyebrow}</span>
        </div>
        <h2
          id="home-categories-heading"
          className="m-0 font-display text-30 font-extrabold tracking-tight text-ink sm:text-34 lg:text-44"
        >
          {m.homeCategoriesTitle}
        </h2>
        <p className="m-0 max-w-2xl font-display text-15 font-normal leading-relaxed text-stone sm:text-16 lg:text-17">
          {m.homeCategoriesSubtitle}
        </p>
      </div>

      {/* Asymmetric 2-Card Layout: Skincare 67% (Right in RTL), Haircare 33% (Left in RTL) */}
      <div className="flex w-full flex-col gap-5 lg:h-[430px] lg:flex-row lg:items-stretch lg:gap-6">
        {/* 1. Skincare Card (67% width on desktop, appears FIRST on the right in RTL) */}
        <Link
          href={routes.productsByCategory(mainCategorySlugs.skin)}
          className="group relative isolate flex w-full flex-col overflow-hidden rounded-card bg-tomato text-chalk no-underline shadow-elevation-1 transition-all duration-base hover:-translate-y-1 hover:shadow-elevation-2 md:flex-row lg:w-[67%]"
          aria-label={m.homeCategorySkinTitle}
        >
          {/* Photographic container (Right side in RTL on desktop/tablet, Top on mobile) */}
          <div className="relative h-56 w-full shrink-0 overflow-hidden sm:h-64 md:h-auto md:w-1/2 lg:h-full">
            <Image
              src="/assets/categories/skincare-editorial.png"
              alt={m.homeCategorySkinTitle}
              fill
              sizes="(min-width: 1024px) 45vw, (min-width: 768px) 50vw, 100vw"
              className="object-cover object-center transition-transform duration-slow ease-standard motion-safe:group-hover:scale-[1.03]"
            />
          </div>

          {/* Shutter orange content panel */}
          <div className="shutter-orange relative z-10 flex flex-1 flex-col justify-between p-6 sm:p-8 lg:p-10">
            {/* Droplet icon badge */}
            <div className="flex items-center justify-start">
              <span
                className="flex size-11 items-center justify-center rounded-full bg-white text-tomato shadow-elevation-1 transition-transform duration-base motion-safe:group-hover:scale-105"
                aria-hidden="true"
              >
                <Icon name="dryness" size={20} strokeWidth={2.2} />
              </span>
            </div>

            {/* Typography & CTA */}
            <div className="mt-5 flex flex-col gap-4 sm:mt-6 lg:mt-8">
              <div className="flex flex-col gap-1.5">
                <h3 className="m-0 font-display text-26 font-black leading-tight text-chalk sm:text-28 md:text-32 lg:text-40">
                  {m.homeCategorySkinTitle}
                </h3>
                <p className="m-0 max-w-sm font-display text-14 font-medium leading-relaxed text-chalk/90 sm:text-15 lg:text-16">
                  {m.homeCategorySkinBody}
                </p>
              </div>

              <div className="pt-1">
                <span className="inline-flex h-control-s items-center gap-2.5 rounded-pill bg-ink px-6 text-14 font-bold text-chalk shadow-elevation-1 transition-all duration-base group-hover:bg-cobalt group-hover:text-chalk sm:h-control-m sm:px-7 sm:text-15">
                  <span className="whitespace-nowrap">{m.homeCategorySkinCta}</span>
                  <span className="transition-transform duration-fast ease-standard motion-safe:group-hover:-translate-x-1">
                    <Icon name="arrow-forward" size={16} strokeWidth={2.2} />
                  </span>
                </span>
              </div>
            </div>
          </div>
        </Link>

        {/* 2. Haircare Card (33% width on desktop, appears SECOND on the left in RTL) */}
        <Link
          href={routes.productsByCategory(mainCategorySlugs.hair)}
          className="group relative isolate flex w-full flex-col overflow-hidden rounded-card bg-cobalt text-chalk no-underline shadow-elevation-1 transition-all duration-base hover:-translate-y-1 hover:shadow-elevation-2 md:flex-row lg:w-[33%] lg:flex-col"
          aria-label={m.homeCategoryHairTitle}
        >
          {/* Photographic container (Top on mobile, Start on tablet, Top 52% on desktop) */}
          <div className="relative h-56 w-full shrink-0 overflow-hidden sm:h-64 md:h-auto md:w-1/2 lg:h-[52%] lg:w-full">
            <Image
              src="/assets/categories/haircare-editorial.png"
              alt={m.homeCategoryHairTitle}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
              className="object-cover object-top transition-transform duration-slow ease-standard motion-safe:group-hover:scale-[1.03]"
            />
          </div>

          {/* Shutter blue content panel */}
          <div className="shutter-blue relative z-10 flex flex-1 flex-col justify-between p-6 sm:p-7 lg:h-[48%]">
            <div className="flex flex-col gap-1.5">
              <h3 className="m-0 font-display text-22 font-black leading-tight text-chalk sm:text-24 lg:text-28">
                {m.homeCategoryHairTitle}
              </h3>
              <p className="m-0 font-display text-13 font-medium leading-relaxed text-chalk/90 sm:text-14 lg:text-15">
                {m.homeCategoryHairBody}
              </p>
            </div>

            <div className="pt-3">
              <span className="inline-flex h-control-s items-center gap-2.5 rounded-pill border-2 border-chalk px-5 text-13 font-bold text-chalk transition-all duration-base group-hover:bg-chalk group-hover:text-cobalt sm:h-control-m sm:px-6 sm:text-14">
                <span className="whitespace-nowrap">{m.homeCategoryHairCta}</span>
                <span className="transition-transform duration-fast ease-standard motion-safe:group-hover:-translate-x-1">
                  <Icon name="arrow-forward" size={16} strokeWidth={2.2} />
                </span>
              </span>
            </div>
          </div>
        </Link>
      </div>
    </Section>
  );
}
