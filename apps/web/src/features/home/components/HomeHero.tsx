'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { buttonVariants } from '@/components/ui/button-variants';
import { Icon } from '@/components/ui/icon';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes, shellRoutes } from '@/lib/routes';
import { HeroPhoto } from './HeroPhoto';
import { HeroProductTag } from './HeroProductTag';

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * Modern Beauty Editorial Campaign Hero:
 * Replaces the split-card with a high-impact, full-bleed photographic campaign section.
 * The art-directed photograph fills the viewport height with controlled cinematic scrims,
 * confident typography, a signature rose accent tag, and a live catalog product pill.
 */
export function HomeHero() {
  const m = useMessages();
  const locale = useLocale();

  return (
    <section aria-labelledby="home-hero-title" className="relative isolate w-full overflow-hidden bg-chalk text-ink">
      {/* Background Campaign Photography */}
      <div className="absolute inset-0 -z-20">
        <HeroPhoto />
      </div>





      {/* Campaign Copy & Editorial Actions */}
      <PageContainer className="relative flex min-h-[560px] flex-col justify-end pb-12 pt-16 sm:min-h-[640px] sm:pb-16 lg:min-h-[680px] lg:justify-center lg:py-24">
        <div className="flex max-w-xl flex-col items-start gap-4 lg:gap-6">
       

          {/* Headline */}
          <h1
            id="home-hero-title"
            className="hero-rise m-0 font-display text-36 font-extrabold leading-tight text-ink sm:text-48 sm:leading-tight lg:text-56 lg:leading-none"
            style={delay(140)}
          >
            {m.homeHeroTitle}
          </h1>

          {/* Subtitle */}
          <p
            className="hero-rise m-0 text-15 leading-26 text-stone sm:text-16 sm:leading-28 lg:text-18 lg:leading-32"
            style={delay(240)}
          >
            {m.homeHeroBody}
          </p>

          {/* Action Row */}
          <div className="hero-rise flex flex-wrap items-center gap-3 pt-2 sm:gap-4" style={delay(340)}>
            <Link
              href={routes.products}
              className="inline-flex h-14 items-center justify-center gap-2.5 rounded-pill bg-ink px-7 text-15 font-bold text-chalk shadow-e1 transition-all duration-fast hover:bg-cobalt hover:shadow-e2 active:scale-95"
            >
              <span>{m.homeHeroCta}</span>
              <Icon name="arrow-forward" size={18} strokeWidth={2.2} />
            </Link>

            <Link
              href={shellRoutes.shina}
              className="inline-flex h-14 items-center justify-center gap-2.5 rounded-pill bg-linen px-6 text-15 font-semibold text-ink shadow-outline-hairline transition-all duration-fast hover:bg-sand/60"
            >
              <span className="size-2.5 rounded-full bg-citron" />
              <span>{m.homeAdvisorPromptCta}</span>
            </Link>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
