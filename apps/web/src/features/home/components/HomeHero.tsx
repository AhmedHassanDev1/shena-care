'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes, shellRoutes } from '@/lib/routes';
import { HeroPhoto } from './HeroPhoto';

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * Editorial split hero: asymmetric grid, crisp 4px photo frame, a clean photograph with nothing laid over it.
 * The copy owns the reading-start column on the chalk ground and never sits on the subject's face; the photograph
 * owns the other seven columns. On phones the photo comes first at a shorter crop so the headline and both actions
 * stay above the fold. The hero says «personalised discovery», not a product promotion, so it carries no product tag.
 */
export function HomeHero() {
  const m = useMessages();

  return (
    <section aria-labelledby="home-hero-title" className="bg-chalk text-ink">
      <PageContainer className="grid gap-6 pb-8 pt-4 lg:grid-cols-12 lg:items-center lg:gap-12 lg:py-12">
        {/* Photograph: end columns on desktop, first on phones */}
        <div className="relative isolate aspect-[4/3] overflow-hidden rounded-image bg-sand sm:aspect-[16/10] lg:order-last lg:col-span-7 lg:aspect-[6/5]">
          <HeroPhoto />
        </div>

        {/* Copy: reading-start columns */}
        <div className="flex flex-col items-start gap-4 lg:col-span-5 lg:gap-6">
          <h1
            id="home-hero-title"
            className="hero-rise m-0 text-balance font-display text-40 font-extrabold leading-tight text-ink sm:text-52 lg:text-64"
            style={delay(120)}
          >
            {m.homeHeroTitle}
          </h1>

          <p className="hero-rise m-0 max-w-md text-pretty text-16 leading-28 text-stone lg:text-18 lg:leading-32" style={delay(220)}>
            {m.homeHeroBody}
          </p>

          <div className="hero-rise flex w-full flex-wrap items-center gap-3 pt-1 sm:w-auto" style={delay(320)}>
            <Link
              href={routes.products}
              className="inline-flex h-control-l flex-1 items-center justify-center gap-2.5 rounded-pill bg-ink px-7 text-15 font-bold text-chalk shadow-elevation-1 transition-[background-color,box-shadow,transform] duration-fast hover:bg-cobalt hover:shadow-elevation-2 active:scale-[.98] sm:flex-none"
            >
              <span>{m.homeHeroCta}</span>
              <Icon name="arrow-forward" size={18} strokeWidth={2.2} />
            </Link>

            <Link
              href={shellRoutes.shina}
              className="inline-flex h-control-l flex-1 items-center justify-center gap-2.5 rounded-pill bg-linen px-6 text-15 font-semibold text-ink shadow-outline-control transition-colors duration-fast hover:bg-sand sm:flex-none"
            >
              <span aria-hidden="true" className="size-2.5 rounded-full bg-citron shadow-outline-hairline" />
              <span>{m.homeAdvisorPromptCta}</span>
            </Link>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
