import Link from 'next/link';
import type { CSSProperties } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { buttonVariants } from '@/components/ui/button-variants';
import { GlassBadge } from '@/components/ui/glass-badge';
import { Icon } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { HeroPhoto } from './HeroPhoto';
import { HeroProductTag } from './HeroProductTag';

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * Hero banner (Stitch: photo card, headline, one action). Phones: the photograph fills the card and the text sits on a
 * night scrim at the bottom. From lg the card becomes a linen frame with the photograph inset on the end side, so the text
 * never covers the subject. A real catalog product floats over the photo as a glass tag when one exists. The text entrance
 * is CSS only (.hero-rise, off under prefers-reduced-motion).
 */
export function HomeHero() {
  const m = getMessages(getLocale());

  return (
    <section aria-labelledby="home-hero-title">
      <PageContainer className="pb-6 pt-3 lg:pb-10 lg:pt-6">
        <div className="relative isolate overflow-hidden rounded-sheet bg-night lg:grid lg:grid-cols-12 lg:bg-linen lg:p-3 lg:shadow-elevation-1">
          <div className="absolute inset-0 -z-10 lg:relative lg:z-0 lg:order-2 lg:col-span-7 lg:min-h-[520px] lg:overflow-hidden lg:rounded-card">
            <HeroPhoto />
          </div>
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-night/90 via-night/40 to-night/0 lg:hidden" />
          <HeroProductTag />

          <div className="relative flex min-h-[460px] flex-col items-start justify-end gap-4 p-6 text-bone lg:order-1 lg:col-span-5 lg:justify-center lg:gap-6 lg:p-12 lg:text-night">
            <GlassBadge tone="photo" className="hero-rise lg:bg-bottle-tint lg:text-bottle lg:shadow-none lg:backdrop-blur-none" style={delay(60)}>
              {m.homeHeroChip}
            </GlassBadge>
            <h1 id="home-hero-title" className="hero-rise m-0 max-w-[12ch] text-display-1 lg:text-display-hero" style={delay(140)}>
              {m.homeHeroTitle}
            </h1>
            <p className="hero-rise m-0 max-w-narrow text-body text-bone/90 lg:text-17 lg:leading-30 lg:text-ink-2" style={delay(240)}>
              {m.homeHeroBody}
            </p>
            <Link href={routes.products} className={`hero-rise mt-1 ${buttonVariants({ variant: 'bottle', size: 'l' })}`} style={delay(340)}>
              {m.homeHeroCta}
              <Icon name="arrow-forward" size={20} strokeWidth={2} />
            </Link>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
