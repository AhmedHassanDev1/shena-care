import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { AuthBackLink } from './AuthBackLink';

/**
 * Production-quality, responsive authentication experience for ShinaCare
 * based on the approved SAHEL Design System.
 *
 * Mobile (Priority):
 *  - Full-width editorial hero with skincare products, warm sunlight, and diagonal shutter shadows.
 *  - Floating top bar: ShinaCare logo with Citron sun dot, circular white back button.
 *  - Warm ivory authentication sheet overlapping the hero bottom with rounded top corners.
 *  - Clear Arabic heading, phone input (+20), primary cobalt pill, switch link.
 *  - Integrated 3-column benefits strip at the bottom of the sheet.
 *
 * Desktop:
 *  - Cohesive two-column layout (55/45 split).
 *  - Editorial column (55%): Warm travertine, shutter sunlight, selective cobalt/tomato accents.
 *  - Form column (45%): Compact, balanced authentication card with single primary CTA.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const m = getMessages(getLocale());

  return (
    <div className="relative min-h-dvh bg-chalk overflow-x-hidden flex flex-col justify-between">
      {/* ── Desktop Header ── */}
      <header className="relative z-10 hidden lg:block w-full border-b border-line-2/20 bg-chalk/80 backdrop-blur-sm">
        <div className="h-16 items-center justify-between px-8 xl:px-12 flex max-w-6xl mx-auto w-full">
          <Link
            href={routes.home}
            aria-label={m.shellHome}
            className="inline-flex items-center no-underline"
          >
            <span className="font-serif italic text-26 text-cobalt flex items-center gap-1.5">
              ShinaCare
              <span className="size-2.5 rounded-full bg-citron ring-2 ring-white/60 inline-block" />
            </span>
          </Link>
          <AuthBackLink variant="desktop" />
        </div>
      </header>

      {/* ── Mobile Editorial Hero (< 1024px) ── */}
      <div className="relative w-full h-64 sm:h-72 overflow-hidden bg-sand/30 lg:hidden">
        <Image
          src="/assets/auth/sahel-auth-editorial.webp"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-[center_32%]"
          priority
        />
        {/* Subtle top gradient to ensure header controls pop cleanly */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/25 via-transparent to-transparent pointer-events-none" />

        {/* Floating Mobile Top Bar */}
        <div className="absolute top-4 inset-x-4 z-20 flex items-center justify-between">
          <Link
            href={routes.home}
            aria-label={m.shellHome}
            className="inline-flex items-center no-underline"
          >
            <span className="font-serif italic text-24 text-cobalt flex items-center gap-1.5 drop-shadow-sm">
              ShinaCare
              <span className="size-2.5 rounded-full bg-citron ring-2 ring-white/70 inline-block" />
            </span>
          </Link>
          <AuthBackLink variant="phone" />
        </div>
      </div>

      {/* ── Main Content Area ── */}
      <main className="relative z-10 flex-1 flex flex-col justify-center px-0 lg:px-8 py-0 lg:py-10">
        {/* Desktop Split-Screen Layout (55/45) */}
        <div className="hidden lg:grid lg:grid-cols-12 lg:gap-8 xl:gap-10 max-w-5xl mx-auto w-full items-stretch">
          {/* Editorial Visual Composition Column (55% -> 7 of 12 cols) */}
          <div className="lg:col-span-7 flex items-center justify-between gap-6 rounded-24 bg-linen/80 border border-line-2/40 p-7 xl:p-8 shadow-elevation-1">
            {/* Editorial Content */}
            <div className="flex-1 flex flex-col justify-between h-full gap-5">
              <div>
                <h1 className="font-display font-black text-28 xl:text-32 text-ink leading-tight">
                  {m.authHeroTitle1}{' '}
                  <span className="text-cobalt">{m.authHeroTitle2}</span>
                </h1>
                <p className="mt-2 text-14 text-stone leading-22 font-display">
                  {m.authHeroSubtitle}
                </p>
              </div>

              {/* Benefit items */}
              <ul className="flex flex-col gap-3 list-none p-0 m-0">
                <li className="flex items-center gap-3 text-13.5 font-semibold text-ink">
                  <span className="flex size-8 items-center justify-center rounded-image bg-sand/70 text-ink flex-none">
                    <Icon name="calendar" size={16} />
                  </span>
                  <span>{m.authFeatureRoutines}</span>
                </li>
                <li className="flex items-center gap-3 text-13.5 font-semibold text-ink">
                  <span className="flex size-8 items-center justify-center rounded-image bg-sand/70 text-ink flex-none">
                    <Icon name="package" size={16} />
                  </span>
                  <span>{m.authFeatureTracking}</span>
                </li>
                <li className="flex items-center gap-3 text-13.5 font-semibold text-ink">
                  <span className="flex size-8 items-center justify-center rounded-image bg-sand/70 text-ink flex-none">
                    <Icon name="heart" size={16} />
                  </span>
                  <span>{m.authFeatureRecommendations}</span>
                </li>
              </ul>
            </div>

            {/* Editorial Visual Asset (Portrait 3:4 with selective cobalt/tomato accents) */}
            <div className="w-[190px] xl:w-[220px] shrink-0 self-stretch relative rounded-image overflow-hidden bg-sand/30 shadow-elevation-1 border border-line-2/30">
              <Image
                src="/assets/auth/sahel-auth-editorial.webp"
                alt=""
                fill
                sizes="(min-width: 1024px) 240px, 0px"
                className="object-cover object-center"
                priority
              />
            </div>
          </div>

          {/* Form Card Column (45% -> 5 of 12 cols) */}
          <div className="lg:col-span-5 flex flex-col justify-center">
            <div className="w-full rounded-24 bg-linen p-7 xl:p-8 shadow-elevation-2 border border-line-2/40">
              {children}
            </div>
          </div>
        </div>

        {/* Mobile Overlapping Warm Ivory Sheet (< 1024px) */}
        <div className="-mt-10 relative z-10 w-full flex-1 rounded-t-32 bg-linen px-5 sm:px-6 pt-7 pb-8 shadow-elevation-3 border-t border-x border-line-2/40 lg:hidden flex flex-col justify-between">
          <div className="w-full max-w-[400px] mx-auto flex flex-col gap-6">
            {children}

            {/* Integrated Small Benefits Strip */}
            <div className="mt-2 rounded-16 border border-line-2/30 bg-sand/30 p-3 shadow-outline-hairline">
              <div className="grid grid-cols-3 divide-x divide-x-reverse divide-line-2/30 text-center">
                <div className="flex flex-col items-center gap-1 px-1">
                  <Icon name="calendar" size={17} className="text-ink" />
                  <span className="text-11 font-display font-semibold text-ink leading-tight">{m.authFeatureRoutines}</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-1">
                  <Icon name="package" size={17} className="text-ink" />
                  <span className="text-11 font-display font-semibold text-ink leading-tight">{m.authFeatureTracking}</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-1">
                  <Icon name="heart" size={17} className="text-ink" />
                  <span className="text-11 font-display font-semibold text-ink leading-tight">{m.authFeatureRecommendations}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Clean Storefront Footer */}
      <footer className="py-4 text-center text-12 text-stone/60">
        <p className="m-0 font-display">© {new Date().getFullYear()} ShinaCare. جميع الحقوق محفوظة.</p>
      </footer>
    </div>
  );
}
