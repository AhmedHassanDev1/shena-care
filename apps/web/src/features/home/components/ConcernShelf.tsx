'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { apiClient } from '@/lib/api-client';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { Concern } from '@/features/catalog/api/discovery';
import { CONCERN_CHIPS, concernHref } from '../lib/concern-chips';

/**
 * Shop by Concern section (Stitch Project: 15204893810740198793).
 *
 * - Header: Citron sun dot, eyebrow ("ابدأ باحتياجك الحقيقي"),
 *   display headline ("إيه اللي حابب " + cobalt "تهتم بيه؟"), and descriptive subtitle.
 * - Desktop Layout (1024px+): 12-column composition inside an ambient Mediterranean card:
 *   - 9 cols: 3x2 grid of authentic still-life cards with asymmetrical inner/outer corner cropping,
 *     title, description, and cobalt directional forward arrow.
 *   - 3 cols: Smart Shina Assistant panel matching section height, featuring presence badge,
 *     editorial prompt, and cobalt pill CTA.
 * - Mobile Layout (<1024px): Horizontal swipeable snap carousel with touch momentum & peek,
 *   followed by a compact horizontal Shina guidance banner.
 * - Accessible, RTL-native, live data integration with fallback to search.
 */
export function ConcernShelf() {
  const m = useMessages();
  const { data } = useQuery({
    queryKey: ['care', 'concerns', 'public'],
    queryFn: () => apiClient.get<Concern[]>('/care/concerns'),
    staleTime: 5 * 60 * 1000,
  });
  const concerns = data ?? [];

  return (
    <section
      id="shop"
      aria-labelledby="home-concern-title"
      className="relative scroll-mt-16 bg-chalk py-6 sm:py-8 lg:py-12"
    >
      <PageContainer>
        {/* Ambient Warm Mediterranean Framing Card (Desktop) */}
        <div className="relative overflow-hidden lg:rounded-32 lg:border lg:border-line lg:bg-linen/60 lg:p-7 xl:p-8 lg:shadow-elevation-1">
          {/* Ambient Warm Lighting Layer (Desktop) */}
          <div className="pointer-events-none absolute -start-16 -top-16 hidden size-72 rounded-full bg-sand/60 blur-3xl lg:block" />
          <div className="pointer-events-none absolute -end-12 bottom-0 hidden size-80 rounded-full bg-dune/25 blur-2xl lg:block" />

          {/* Section Header */}
          <header className="relative z-10 mb-4 flex flex-col justify-between gap-3 text-start md:flex-row md:items-end lg:mb-6">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-citron shadow-outline-hairline" />
                <span className="font-display text-12 font-semibold uppercase tracking-wider text-stone">
                  {m.homeConcernEyebrow}
                </span>
              </div>
              <h2
                id="home-concern-title"
                className="font-display text-26 font-extrabold tracking-tight text-ink sm:text-30 lg:text-34"
              >
                {m.homeConcernHeadlineStart}
                <span className="text-cobalt">{m.homeConcernHeadlineAccent}</span>
              </h2>
            </div>
            <p className="max-w-md text-13 font-normal leading-relaxed text-stone sm:text-14 md:pb-1">
              {m.homeConcernSubtitle}
            </p>
          </header>

          {/* =========================================================================
              DESKTOP VIEW (1024px+): 12-Column Layout
              9 Columns: 3x2 Concern Cards Grid
              3 Columns: Shina Assistant Panel
              ========================================================================= */}
          <div className="relative z-10 hidden items-stretch gap-4 lg:grid lg:grid-cols-12 lg:gap-5">
            {/* 3x2 Cards Grid (9 cols) */}
            <div className="col-span-9 grid grid-cols-3 gap-3.5">
              {CONCERN_CHIPS.map((chip) => {
                const label = m[chip.label];
                const desc = m[chip.desc];
                const { href } = concernHref(chip, label, concerns);

                return (
                  <Link
                    key={chip.id}
                    href={href}
                    className={cn(
                      'group relative flex min-h-[160px] cursor-pointer flex-col justify-between overflow-hidden rounded-card border border-line bg-white p-3 shadow-elevation-1 transition-all duration-base',
                      'hover:-translate-y-1 hover:shadow-elevation-2 active:scale-[0.99]'
                    )}
                  >
                    <div className="flex h-full items-stretch gap-3">
                      {/* Image container (~42% width) with asymmetric corner rounding */}
                      <div className="relative min-h-[136px] w-[42%] flex-shrink-0 overflow-hidden rounded-ss-14 rounded-es-14 rounded-se-4 rounded-ee-4 bg-sand/30">
                        <Image
                          src={chip.image}
                          alt={label}
                          fill
                          sizes="(min-width: 1280px) 160px, (min-width: 1024px) 140px, 120px"
                          className="object-cover transition-transform duration-base group-hover:scale-105"
                        />
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/10 via-transparent to-transparent" />
                      </div>

                      {/* Content side */}
                      <div className="flex flex-1 flex-col justify-between py-0.5 min-w-0 text-start">
                        <div>
                          <h3 className="font-display text-18 font-bold leading-tight text-ink transition-colors duration-fast group-hover:text-cobalt lg:text-19">
                            {label}
                          </h3>
                          <p className="mt-1 line-clamp-2 text-12 font-normal leading-relaxed text-stone">
                            {desc}
                          </p>
                        </div>
                        <div className="flex justify-end pt-1">
                          <span className="flex size-7 items-center justify-center rounded-full border border-line bg-chalk text-stone shadow-elevation-1 transition-all duration-fast group-hover:border-cobalt group-hover:bg-cobalt group-hover:text-white">
                            <Icon
                              name="arrow-forward"
                              size={14}
                              strokeWidth={2.2}
                              className="transition-transform duration-fast group-hover:-translate-x-0.5"
                            />
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Smart Shina Assistant Panel (3 cols) */}
            <aside className="relative col-span-3 flex flex-col justify-between overflow-hidden rounded-card border border-line bg-linen p-5 shadow-elevation-1 lg:p-6">
              {/* Decorative atmosphere */}
              <div className="pointer-events-none absolute -start-10 -top-10 size-32 rounded-full bg-chalk/80 blur-xl" />
              <div className="pointer-events-none absolute bottom-1 start-2 select-none font-serif text-52 tracking-tight text-stone/15">
                Shina
              </div>

              {/* Top Presence Badge */}
              <div className="relative z-10 text-start">
                <div className="inline-flex items-center gap-2 rounded-full border border-line bg-chalk/80 px-3 py-1">
                  <span className="size-2.5 flex-shrink-0 animate-pulse rounded-full bg-citron" />
                  <span className="font-display text-12 font-bold text-ink">
                    {m.homeConcernAssistantBadge}
                  </span>
                </div>
              </div>

              {/* Center Copy */}
              <div className="relative z-10 my-auto py-4 text-start">
                <h3 className="mb-2.5 font-display text-24 font-extrabold leading-tight text-ink lg:text-28">
                  {m.homeConcernAssistantTitle}
                </h3>
                <p className="text-14 leading-relaxed text-stone lg:text-15">
                  {m.homeConcernAssistantBody}
                </p>
              </div>

              {/* Bottom CTA */}
              <div className="relative z-10 pt-2">
                <Link
                  href={shellRoutes.shina}
                  className="group/btn inline-flex w-full items-center justify-center gap-2.5 rounded-pill bg-cobalt px-6 py-2.5 font-display text-16 font-bold text-white shadow-elevation-1 transition-all hover:bg-cobalt-deep"
                >
                  <span>{m.homeConcernAssistantCta}</span>
                  <Icon
                    name="arrow-forward"
                    size={16}
                    strokeWidth={2.2}
                    className="transition-transform duration-fast group-hover/btn:-translate-x-0.5"
                  />
                </Link>
              </div>
            </aside>
          </div>

          {/* =========================================================================
              MOBILE VIEW (<1024px): Horizontal Carousel & Guidance Banner
              Touch momentum snap scroll with card peek (~15-20%)
              ========================================================================= */}
          <div className="relative z-10 flex flex-col gap-4 lg:hidden">
            {/* Horizontal Swipeable Carousel */}
            <div
              dir="rtl"
              className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-1 scroll-smooth"
            >
              {CONCERN_CHIPS.map((chip) => {
                const label = m[chip.label];
                const desc = m[chip.desc];
                const { href } = concernHref(chip, label, concerns);

                return (
                  <Link
                    key={chip.id}
                    href={href}
                    className={cn(
                      'group flex w-[280px] flex-shrink-0 snap-start flex-col justify-between rounded-card border border-line bg-linen p-3.5 shadow-elevation-1 transition-all sm:w-[295px]',
                      'active:scale-[0.98]'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {/* Image container */}
                      <div className="relative size-24 flex-shrink-0 overflow-hidden rounded-14 border border-line bg-sand/30">
                        <Image
                          src={chip.image}
                          alt={label}
                          fill
                          sizes="96px"
                          className="object-cover"
                        />
                      </div>

                      {/* Content side */}
                      <div className="flex-1 min-w-0 pe-0.5 text-start">
                        <h3 className="font-display text-17 font-bold leading-tight text-ink transition-colors group-hover:text-cobalt">
                          {label}
                        </h3>
                        <p className="mt-1 line-clamp-2 text-12 font-normal leading-snug text-stone">
                          {desc}
                        </p>
                      </div>
                    </div>

                    {/* Bottom row arrow */}
                    <div className="mt-2.5 flex items-center justify-end border-t border-line pt-2">
                      <span className="flex size-6 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-elevation-1 transition-all group-hover:border-cobalt group-hover:bg-cobalt group-hover:text-white">
                        <Icon name="arrow-forward" size={14} strokeWidth={2.2} />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Mobile Guidance Banner */}
            <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-linen p-3.5 shadow-elevation-1">
              <div className="flex-1 min-w-0 pe-1 text-start">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="size-2 flex-shrink-0 rounded-full bg-citron" />
                  <h3 className="font-display text-13 font-bold leading-none text-ink">
                    {m.homeConcernAssistantTitle}
                  </h3>
                </div>
                <p className="truncate text-11 font-medium leading-tight text-stone">
                  {m.homeConcernAssistantBody}
                </p>
              </div>

              <Link
                href={shellRoutes.shina}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-pill bg-cobalt px-3.5 py-1.5 font-display text-12 font-bold text-white shadow-elevation-1 transition-transform hover:bg-cobalt-deep active:scale-95"
              >
                <span>{m.homeConcernAssistantMobileCta}</span>
                <Icon name="arrow-forward" size={12} strokeWidth={2.2} />
              </Link>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
