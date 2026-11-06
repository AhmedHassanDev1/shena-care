'use client';

import Image from 'next/image';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';

/**
 * ShinaCare Sahel Hero Section
 *
 * Primary visual reference: Google Stitch Sahel Hero project (1325875511695454376).
 * - Desktop (1024px+): Full-width editorial scene with unbranded skincare & haircare
 *   products on travertine pedestals on the left, and Arabic display typography with
 *   dual CTAs positioned over natural chalk negative space on the right.
 * - Mobile (360px - 1023px): Editorial 4:3 still life at top, followed by English eyebrow,
 *   Arabic headline with Citron underline on «مش من المنتج.», body copy, full-width Tomato
 *   primary CTA, and lightweight secondary CTA link.
 * - Restrained animations with full prefers-reduced-motion safety.
 */
export function SahelHero() {
  const m = useMessages();

  return (
    <section
      aria-label={m.sahelHeroEyebrow}
      className="relative w-full overflow-hidden bg-chalk text-ink"
    >
      {/* =========================================================================
          DESKTOP VIEW (1024px+): Full-width photographic backdrop with products
          on the left (end in RTL) and typography on the right (start in RTL).
          ========================================================================= */}
      <div className="relative hidden w-full lg:flex lg:min-h-[500px] xl:min-h-[540px] items-center justify-start overflow-hidden">
        {/* Photographic background: authentic Stitch high-res asset */}
        <div className="absolute inset-0 z-0 animate-hero-fade">
          <Image
            src="/assets/home/sahel-hero-desktop.webp"
            alt={m.sahelHeroAltDesktop}
            fill
            priority
            sizes="(min-width: 1024px) 1440px, 100vw"
            className="object-cover object-center pointer-events-none select-none"
          />
        </div>

        {/* Content container over start side (Right in RTL) */}
        <PageContainer className="relative z-10 w-full">
          <div className="flex flex-col items-start text-start max-w-xl py-12 lg:py-16">
            {/* Eyebrow */}
            <div
              dir="ltr"
              className="inline-flex items-center gap-2 mb-4 select-none animate-hero-slide-1"
            >
              <span aria-hidden="true" className="w-7 h-1 bg-cobalt rounded-pill inline-block" />
              <span className="text-13 font-extrabold tracking-widest text-cobalt uppercase">
                {m.sahelHeroEyebrow}
              </span>
            </div>

            {/* Arabic Headline with Citron Underline */}
            <h1 className="font-display text-40 lg:text-52 font-extrabold text-ink leading-tight tracking-tight mb-4 animate-hero-slide-2">
              <span className="block">{m.sahelHeroHeadlineStart}</span>
              <span className="relative inline-block mt-1 whitespace-nowrap">
                <span className="relative z-10">{m.sahelHeroHeadlineAccent}</span>
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 inset-x-0 h-3 bg-citron rounded-4 -z-0 opacity-90"
                />
              </span>
            </h1>

            {/* Supporting Description */}
            <p className="font-text text-16 lg:text-18 leading-28 lg:leading-32 text-stone max-w-md mb-8 animate-hero-slide-3">
              {m.sahelHeroDescription}
            </p>

            {/* Side-by-Side CTAs */}
            <div className="flex flex-row items-center gap-4 animate-hero-slide-4">
              {/* Primary CTA (Tomato Orange) */}
              <Link
                href="#shop"
                className="group inline-flex h-control-l items-center justify-center gap-2.5 rounded-pill bg-tomato px-7 text-15 font-bold text-white shadow-elevation-1 transition-[background-color,box-shadow,transform] duration-fast hover:bg-tomato/90 hover:shadow-elevation-2 active:scale-[.98]"
              >
                <span>{m.sahelHeroPrimaryCta}</span>
                <Icon
                  name="arrow-forward"
                  size={18}
                  strokeWidth={2.2}
                  className="transition-transform duration-fast group-hover:-translate-x-1"
                />
              </Link>

              {/* Secondary CTA (Cobalt Blue Outline) */}
              <Link
                href="#routines"
                className="inline-flex h-control-l items-center justify-center gap-2 rounded-pill bg-transparent px-6 text-15 font-bold text-cobalt shadow-outline-cobalt transition-colors duration-fast hover:bg-cobalt/10 active:scale-[.98]"
              >
                <span>{m.sahelHeroSecondaryCta}</span>
                <Icon name="chevron-forward" size={16} strokeWidth={2.2} />
              </Link>
            </div>
          </div>
        </PageContainer>
      </div>

      {/* =========================================================================
          MOBILE VIEW (< 1024px: 360px, 390px, tablet):
          Top editorial still life image, followed by eyebrow, headline, description,
          full-width primary Tomato CTA, and secondary lightweight CTA.
          ========================================================================= */}
      <div className="flex flex-col lg:hidden w-full pb-8">
        {/* 1. Top Editorial Image */}
        <div className="w-full relative px-4 pt-3 pb-2 animate-hero-fade">
          <div className="relative w-full aspect-[4/3] rounded-image overflow-hidden shadow-elevation-1 bg-sand">
            <Image
              src="/assets/home/sahel-hero-mobile.webp"
              alt={m.sahelHeroAltMobile}
              fill
              priority
              sizes="(max-width: 1023px) 100vw, 540px"
              className="object-cover object-center"
            />
          </div>
        </div>

        {/* 2. Content Block Below Image */}
        <PageContainer className="flex flex-col items-start w-full text-start pt-3">
          {/* Eyebrow */}
          <div
            dir="ltr"
            className="inline-flex items-center gap-2 mb-2 select-none animate-hero-slide-1"
          >
            <span aria-hidden="true" className="w-5 h-1 bg-cobalt rounded-pill inline-block" />
            <span className="text-12 font-extrabold tracking-widest text-cobalt uppercase">
              {m.sahelHeroEyebrow}
            </span>
          </div>

          {/* Arabic Headline */}
          <h1 className="font-display text-28 sm:text-32 font-extrabold text-ink leading-tight tracking-tight mb-3 w-full animate-hero-slide-2">
            <span className="block">{m.sahelHeroHeadlineStart}</span>
            <span className="relative inline-block mt-0.5 whitespace-nowrap">
              <span className="relative z-10">{m.sahelHeroHeadlineAccent}</span>
              <span
                aria-hidden="true"
                className="absolute bottom-1 inset-x-0 h-2.5 bg-citron rounded-4 -z-0 opacity-90"
              />
            </span>
          </h1>

          {/* Supporting Description */}
          <p className="font-text text-15 sm:text-16 leading-24 sm:leading-28 text-stone mb-6 w-full animate-hero-slide-3">
            {m.sahelHeroDescription}
          </p>

          {/* 3. Stacked CTAs */}
          <div className="flex flex-col gap-3 w-full animate-hero-slide-4">
            {/* Primary CTA (Tomato Full-Width Button) */}
            <Link
              href="#shop"
              className="group flex h-control-l w-full items-center justify-center gap-2.5 rounded-pill bg-tomato px-6 text-15 font-bold text-white shadow-elevation-1 transition-[background-color,box-shadow,transform] duration-fast hover:bg-tomato/90 active:scale-[.98]"
            >
              <span>{m.sahelHeroPrimaryCta}</span>
              <Icon
                name="arrow-forward"
                size={18}
                strokeWidth={2.2}
                className="transition-transform duration-fast group-hover:-translate-x-1"
              />
            </Link>

            {/* Secondary CTA (Lightweight Link Below Primary) */}
            <Link
              href="#routines"
              className="inline-flex items-center justify-center gap-1.5 pt-1 text-15 font-bold text-cobalt transition-colors duration-fast hover:text-cobalt-deep"
            >
              <span className="underline underline-offset-4 decoration-cobalt/40 hover:decoration-cobalt">
                {m.sahelHeroSecondaryCta}
              </span>
              <Icon name="chevron-forward" size={16} strokeWidth={2.2} />
            </Link>
          </div>
        </PageContainer>
      </div>
    </section>
  );
}
