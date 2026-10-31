'use client';

import Image from 'next/image';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes, shellRoutes } from '@/lib/routes';
import { HOME_IMAGES } from '../lib/home-images';

/**
 * Modern Beauty Editorial: Create Your Routine (Shina Studio Banner)
 * Premium image-led rectangular campaign banner with warm beauty photography,
 * restrained dark contrast for pristine text legibility, and distinct routine/advisor journeys.
 */
export function ShinaStudio() {
  const m = useMessages();
  const studio = HOME_IMAGES.studio;

  return (
    <section aria-labelledby="home-studio-title" className="py-10 lg:py-16">
      <PageContainer>
        <div className="group relative isolate overflow-hidden rounded-card shadow-e2 min-h-[360px] sm:min-h-[380px] lg:min-h-[400px] flex items-center">
          {/* Background Photography — Full rich image, no white washout */}
          <div aria-hidden="true" className="absolute inset-0 -z-20 overflow-hidden">
            <Image
              src={studio.src}
              alt=""
              fill
              sizes="(min-width: 1280px) 1200px, 100vw"
              className="object-cover object-center transition-transform duration-700 ease-standard group-hover:scale-105"
            />
          </div>

          {/* Restrained Dark/Taupe Contrast Scrim — local to text area */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-gradient-to-t from-ink/90 via-ink/65 to-ink/20 lg:bg-gradient-to-r rtl:lg:bg-gradient-to-l lg:from-ink/90 lg:via-ink/60 lg:via-45% lg:to-transparent"
          />

          {/* Content & CTAs */}
          <div className="relative z-10 flex max-w-xl flex-col items-start gap-4 p-6 sm:p-10 lg:p-14">
            {/* Eyebrow */}
            <div className="flex items-center gap-2 text-chalk/80 text-13 font-semibold tracking-wider">
              <span className="h-px w-6 bg-chalk/60" aria-hidden="true" />
              <span>شينا كير</span>
            </div>

            {/* Headline */}
            <h2
              id="home-studio-title"
              className="m-0 font-display text-28 font-black leading-tight text-chalk sm:text-36 sm:leading-tight lg:text-42 lg:leading-tight"
            >
              {m.homeStudioTitle}
            </h2>

            {/* Supporting Copy */}
            <p className="m-0 text-15 leading-24 text-chalk/85 sm:text-16 sm:leading-28">
              {m.homeStudioBody}
            </p>

            {/* Action Buttons: Explicitly segregated paths */}
            <div className="flex flex-wrap items-center gap-3 pt-2 sm:gap-4">
              {/* Primary: Structured Routine Builder */}
              <Link
                href={routes.routineBuilder}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-pill bg-chalk px-7 text-14 font-bold text-ink shadow-e1 transition-all duration-fast hover:bg-linen active:scale-95"
              >
                <span>{m.navBuildRoutine}</span>
                <Icon name="arrow-forward" size={16} strokeWidth={2.4} />
              </Link>

              {/* Secondary: Conversational AI Advisor */}
              <Link
                href={shellRoutes.shina}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-pill bg-chalk/15 backdrop-blur-md border border-chalk/30 px-6 text-14 font-semibold text-chalk shadow-sm transition-all duration-fast hover:bg-chalk/25 active:scale-95"
              >
                <Icon name="sparkles" size={16} className="text-citron" />
                <span>{m.footerAskShina}</span>
              </Link>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
