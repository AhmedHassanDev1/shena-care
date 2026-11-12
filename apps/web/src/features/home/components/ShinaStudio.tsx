'use client';

import Image from 'next/image';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes, shellRoutes } from '@/lib/routes';
import { HOME_IMAGES } from '../lib/home-images';

/**
 * The Routine Atelier — Editorial Campaign Banner
 * Redesigned from the approved SAHEL Creative Direction:
 * - Premium warm editorial composition on soft chalk/linen ground (zero dark/black backgrounds).
 * - Asymmetric two-part architectural balance with generous negative space.
 * - Right: Bold Arabic editorial display typography, clear routine guidance, and vibrant Cobalt CTA.
 * - Left: High-art Still Life photography with unlabelled amber/frosted droppers on stone plinth,
 *   subtle morning shadow, and an abstract 3-step routine sequence metaphor (Cleanse · Target · Hydrate).
 * - Reassurance micro-feature badges (Targeted · Clear Schedule · Scientifically Backed).
 */
export function ShinaStudio() {
  const m = useMessages();
  const atelier = HOME_IMAGES.atelier;

  const routineSteps = [
    { step: '١', label: m.atelierStep1, icon: 'sun' as const },
    { step: '٢', label: m.atelierStep2, icon: 'science' as const },
    { step: '٣', label: m.atelierStep3, icon: 'shield' as const },
  ];

  const microFeatures = [
    { label: m.atelierFeature1, icon: 'shield' as const },
    { label: m.atelierFeature2, icon: 'routine' as const },
    { label: m.atelierFeature3, icon: 'science' as const },
  ];

  return (
    <section aria-labelledby="routine-atelier-title" className="py-4 md:py-5 lg:py-6">
      <PageContainer>
        <div className="relative isolate overflow-hidden rounded-card border border-line bg-linen shadow-elevation-1 transition-all duration-base hover:shadow-elevation-2">
          {/* Subtle Warm Limestone Architectural Ambient Glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 end-0 -z-10 size-96 rounded-full bg-sand/40 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 start-0 -z-10 size-96 rounded-full bg-tan/20 blur-3xl"
          />

          {/* Asymmetric Two-Column Editorial Grid */}
          <div className="grid grid-cols-1 items-center lg:grid-cols-12">
            {/* Right Column: Editorial Copy & Action Journeys (7 cols on lg) */}
            <div className="flex flex-col items-start gap-3.5 sm:gap-4 p-4 sm:p-6 lg:p-8 lg:col-span-7">
              {/* Atelier Eyebrow with Pulsing Sparkle */}
              <div className="inline-flex items-center gap-2 rounded-pill border border-line/60 bg-chalk/90 px-3.5 py-1.5 shadow-outline-hairline backdrop-blur-sm">
                <Icon name="sparkles" size={13} className="text-cobalt" />
                <span className="font-display text-12 font-bold tracking-wide text-ink">
                  {m.atelierEyebrow}
                </span>
              </div>

              {/* Architectural Main Headline */}
              <h2
                id="routine-atelier-title"
                className="m-0 font-display text-28 font-black leading-tight text-ink sm:text-34 sm:leading-tight lg:text-40 lg:leading-tight"
              >
                <span>مش منتجات أكتر.</span>
                <span className="mt-1 block text-cobalt">روتين أوضح.</span>
              </h2>

              {/* Editorial Description */}
              <p className="m-0 max-w-lg font-display text-14 leading-22 text-stone sm:text-15 sm:leading-24 lg:text-16 lg:leading-26">
                {m.atelierDescription}
              </p>

              {/* Action Buttons: Clear Journey Segregation */}
              <div className="flex w-full flex-col gap-3 pt-2 md:w-auto md:flex-row md:items-center md:gap-4">
                {/* Primary CTA: Structured Routine Builder */}
                <Link
                  href={routes.routineBuilder}
                  className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-cobalt px-8 text-14 font-bold text-chalk shadow-elevation-1 transition-all duration-fast hover:bg-cobalt-deep hover:shadow-elevation-2 active:scale-95 md:w-auto whitespace-nowrap"
                >
                  <span>{m.atelierPrimaryCta}</span>
                  <Icon
                    name="arrow-forward"
                    size={16}
                    strokeWidth={2.4}
                    className="transition-transform duration-fast group-hover:-translate-x-1"
                  />
                </Link>

                {/* Secondary CTA: Conversational Beauty Advisor */}
                <Link
                  href={shellRoutes.shina}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-pill border border-line bg-chalk px-7 text-14 font-bold text-ink shadow-elevation-1 transition-all duration-fast hover:border-cobalt hover:bg-linen hover:text-cobalt active:scale-95 md:w-auto whitespace-nowrap"
                >
                  <Icon name="sparkles" size={15} className="text-cobalt" />
                  <span>{m.atelierSecondaryCta}</span>
                </Link>
              </div>

              {/* Reassuring Micro-Feature Strip */}
              <div className="mt-2 flex w-full flex-wrap items-center gap-3 border-t border-line/60 pt-4 sm:gap-5">
                {microFeatures.map((feat, idx) => (
                  <div key={feat.label} className="flex items-center gap-2 text-stone">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sand/60 text-cobalt">
                      <Icon name={feat.icon} size={13} strokeWidth={2} />
                    </span>
                    <span className="font-display text-11 font-medium text-ink sm:text-12 whitespace-nowrap">
                      {feat.label}
                    </span>
                    {idx < microFeatures.length - 1 ? (
                      <span className="text-line-2/40 ms-2 hidden sm:inline" aria-hidden="true">
                        |
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Left Column: Visual Metaphor & Photographic Still Life (5 cols on lg) */}
            <div className="relative flex flex-col items-center justify-center p-4 sm:p-6 lg:col-span-5 lg:p-8">
              <div className="relative w-full max-w-[420px]">
                {/* Photographic Still Life */}
                <div className="relative aspect-[486/320] w-full overflow-hidden rounded-card">
                  <Image
                    src={atelier.src}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 420px, (min-width: 768px) 380px, 100vw"
                    className="object-contain object-center"
                    priority={false}
                  />
                </div>

                {/* Routine Step Sequence Metaphor Overlay */}
                <div className="mt-3 rounded-pill border border-line/70 bg-chalk/90 px-4 py-2.5 shadow-elevation-1 backdrop-blur-md">
                  <div className="flex items-center justify-between gap-1 sm:gap-2">
                    {routineSteps.map((s, idx) => (
                      <div key={s.step} className="flex items-center gap-1.5 sm:gap-2">
                        <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-sand font-display text-11 font-bold text-cobalt">
                          {s.step}
                        </span>
                        <span className="font-display text-11 font-bold text-ink sm:text-12 whitespace-nowrap">
                          {s.label}
                        </span>
                        {idx < routineSteps.length - 1 ? (
                          <span className="text-line-2 ms-1 select-none" aria-hidden="true">
                            ·
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
