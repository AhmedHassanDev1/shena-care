import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { AuthBackLink } from './AuthBackLink';

/**
 * Production-quality, responsive authentication experience for ShinaCare
 * based on the approved SAHEL Design System, using the unified frame structure:
 *
 * - Structure: A single unified master container with rounded-32 corners.
 * - Visual side: A floating rounded-24 portrait card nested with padding inside the chassis,
 *   compact on mobile (h-44 / 176px) so the form appears immediately above the fold,
 *   and expansive on desktop (lg:min-h-[560px]).
 * - Form side: Clean, vertically centered form section inside the same master card.
 * - Colors: 100% faithful to the Sahel design system (Chalk ground, Linen chassis, Ink text, Cobalt action).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const m = getMessages(getLocale());

  return (
    <div className="relative min-h-dvh bg-chalk overflow-x-hidden flex flex-col justify-between">
      {/* ── Top Header ── */}
      <header className="relative z-20 w-full border-b border-line-2/20 bg-chalk/80 backdrop-blur-sm">
        <div className="h-16 items-center justify-between px-6 lg:px-10 xl:px-14 flex max-w-6xl mx-auto w-full">
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

      {/* ── Main Content Area ── */}
      <main className="relative z-10 flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-8 py-5 lg:py-10 w-full max-w-5xl xl:max-w-6xl mx-auto">
        {/* Unified Master Card (Structure matching reference layout, 100% Sahel palette) */}
        <div className="w-full rounded-32 bg-linen text-ink p-3 sm:p-6 lg:p-7 shadow-elevation-2 border border-line-2/40 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 lg:gap-8 xl:gap-10 items-stretch">
          {/* Inner Visual Editorial Card: compact on mobile so form appears fast, full height on desktop */}
          <div className="lg:col-span-6 rounded-24 overflow-hidden relative shadow-elevation-1 h-32 sm:h-44 lg:h-auto lg:min-h-[560px] border border-line-2/30 bg-sand/30">
            <Image
              src="/assets/auth/sahel-auth-editorial.webp"
              alt="ShinaCare Beauty"
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover object-center lg:transition-transform lg:duration-700 lg:hover:scale-105"
              priority
            />
            {/* Subtle bottom gradient to ensure brand mark pops */}
            <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/20 to-transparent pointer-events-none" />

            {/* Floating Brand Badge & Tagline at bottom of image */}
            <div className="absolute inset-x-3 bottom-2.5 sm:inset-x-6 sm:bottom-5 z-10 flex flex-col gap-1 sm:gap-2 text-start">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill bg-white/20 backdrop-blur-md border border-white/30 text-10.5 sm:text-12 font-bold text-white self-start">
                <span className="size-1.5 sm:size-2 rounded-full bg-citron ring-2 ring-white/80 inline-block" />
                <span>طقوس العناية الفاخرة</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-serif italic text-18 sm:text-26 lg:text-30 text-white flex items-center gap-1.5 drop-shadow-md">
                  ShinaCare
                  <span className="size-2 sm:size-2.5 rounded-full bg-citron ring-2 ring-white/80 inline-block" />
                </span>
              </div>
              <p className="m-0 text-12 sm:text-13 text-chalk/90 font-display leading-18 drop-shadow-sm max-w-xs hidden sm:block">
                عناية متكاملة بجمالك الطبيعي مستوحاة من رمال وأشعة الساحل.
              </p>
            </div>
          </div>

          {/* Form Section Column (Directly inside the unified chassis, vertically centered) */}
          <div className="lg:col-span-6 flex flex-col justify-center px-1 sm:px-4 lg:px-6 py-2 sm:py-4 lg:py-6">
            {children}
          </div>
        </div>
      </main>

      {/* ── Storefront Footer ── */}
      <footer className="relative z-10 py-4 text-center text-12 text-stone/60">
        <p className="m-0 font-display">© {new Date().getFullYear()} ShinaCare. جميع الحقوق محفوظة.</p>
      </footer>
    </div>
  );
}
