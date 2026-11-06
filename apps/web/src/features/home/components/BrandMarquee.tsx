'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { apiClient } from '@/lib/api-client';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';

interface BrandRecord {
  id?: string;
  slug: string;
  name: string;
  isActive: boolean;
  logoUrl?: string | null;
}

interface EditorialBrand {
  slug: string;
  name: string;
  subtitleAr: string;
  subtitleEn: string;
  renderWordmark: () => React.ReactNode;
}

const EDITORIAL_BRAND_DEFINITIONS: Record<string, { subtitleAr: string; subtitleEn: string; render: () => React.ReactNode }> = {
  starville: {
    subtitleAr: 'عناية وتفتيح',
    subtitleEn: 'Skin Clarifying & Glow',
    render: () => (
      <span className="font-text text-18 font-extrabold tracking-widest uppercase text-ink transition-colors duration-fast group-hover:text-cobalt sm:text-20 lg:text-22">
        STARVILLE
      </span>
    ),
  },
  'eva-cosmetics': {
    subtitleAr: 'ترطيب وحماية',
    subtitleEn: 'Hydration & Defense',
    render: () => (
      <div className="flex flex-col items-center leading-none">
        <span className="font-serif text-22 italic text-ink tracking-tight transition-colors duration-fast group-hover:text-cobalt sm:text-26 lg:text-28">
          Eva
        </span>
        <span className="mt-0.5 font-text text-10.5 font-bold tracking-widest uppercase text-ink/75 transition-colors duration-fast group-hover:text-cobalt">
          COSMETICS
        </span>
      </div>
    ),
  },
  'the-hair-addict': {
    subtitleAr: 'عناية بالشعر الكيرلي',
    subtitleEn: 'Curl Definition & Care',
    render: () => (
      <span className="font-text text-13 font-black tracking-widest uppercase text-ink leading-tight transition-colors duration-fast group-hover:text-cobalt sm:text-14 lg:text-15">
        THE HAIR ADDICT
      </span>
    ),
  },
  dermactive: {
    subtitleAr: 'تركيبات علاجية',
    subtitleEn: 'Clinical Formulations',
    render: () => (
      <span className="font-text text-16 font-bold tracking-wider text-ink transition-colors duration-fast group-hover:text-cobalt sm:text-18 lg:text-20">
        DERM<span className="font-light text-ink/70">ACTIVE</span>
      </span>
    ),
  },
  bless: {
    subtitleAr: 'تغذية وتحديد التموجات',
    subtitleEn: 'Nourishment & Curl Care',
    render: () => (
      <span className="font-text text-18 font-black tracking-widest uppercase text-ink transition-colors duration-fast group-hover:text-cobalt sm:text-20 lg:text-22">
        BLESS
      </span>
    ),
  },
};

const CURATED_BRAND_KEYS = ['starville', 'eva-cosmetics', 'the-hair-addict', 'dermactive', 'bless'];

/**
 * Animated Brands Marquee: Continuous Editorial Ribbon
 * Meets P0 specification:
 * - Slow, seamless, continuous horizontal motion (60s loop)
 * - Natural RTL-native velocity with smooth linear movement and zero restart snapping
 * - Pause on hover and keyboard focus for effortless interaction
 * - Edge gradient mask for refined typographic entrance and exit
 * - Accessible: original set is focusable, cloned set is hidden from screen readers (aria-hidden)
 * - Respects prefers-reduced-motion
 */
export function BrandMarquee() {
  const m = useMessages();

  const { data } = useQuery({
    queryKey: ['brands', 'public'],
    queryFn: async () => {
      try {
        const res = await apiClient.get<BrandRecord[]>('/brands');
        return Array.isArray(res) && res.length > 0 ? res : null;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const displayBrands: EditorialBrand[] = useMemo(() => {
    const activeSlugs = new Set((data ?? []).filter((b) => b.isActive).map((b) => b.slug));
    const matchingActive = CURATED_BRAND_KEYS.filter((k) => activeSlugs.has(k));
    const fallbackRest = CURATED_BRAND_KEYS.filter((k) => !matchingActive.includes(k));
    const finalKeys = [...matchingActive, ...fallbackRest];

    return finalKeys.map((slug) => {
      const def = EDITORIAL_BRAND_DEFINITIONS[slug] ?? {
        subtitleAr: 'منتجات معتمدة',
        subtitleEn: 'Verified Products',
        render: () => (
          <span className="font-text text-16 font-extrabold tracking-wider uppercase text-ink">
            {slug.toUpperCase()}
          </span>
        ),
      };
      const record = (data ?? []).find((b) => b.slug === slug);
      return {
        slug,
        name: record?.name ?? slug,
        subtitleAr: def.subtitleAr,
        subtitleEn: def.subtitleEn,
        renderWordmark: def.render,
      };
    });
  }, [data]);

  return (
    <section
      aria-labelledby="brand-strip-title"
      className="w-full border-y border-line bg-chalk py-10 lg:py-16 transition-colors"
    >
      <PageContainer className="flex flex-col gap-6">
        {/* Header row: Eyebrow + Title + Subtitle + Action Link */}
        <div className="flex flex-col justify-between gap-4 border-b border-line pb-6 md:flex-row md:items-end">
          <div className="flex max-w-2xl flex-col gap-2">
            {/* Atelier Eyebrow with Sun Dot */}
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-citron ring-2 ring-citron/30 shadow-outline-hairline" />
              <span className="text-11 font-semibold uppercase tracking-wider text-stone">
                {m.homeBrandsEyebrow}
              </span>
            </div>

            {/* Architectural Section Title */}
            <h2
              id="brand-strip-title"
              className="m-0 font-display text-26 font-extrabold tracking-tight text-ink sm:text-30 lg:text-34"
            >
              {m.homeBrandsTitle}
            </h2>

            {/* Editorial Subtitle */}
            <p className="m-0 text-14 leading-22 text-stone sm:text-15 sm:leading-24">
              {m.homeBrandsBody}
            </p>
          </div>

          {/* Action Link: All Brands */}
          <Link
            href={routes.products}
            className="group inline-flex items-center gap-2 self-start pb-1 text-14 font-semibold text-ink transition-colors hover:text-cobalt md:self-end"
          >
            <span className="hidden md:inline">{m.homeBrandsAll}</span>
            <span className="md:hidden">{m.homeBrandsAllMobile}</span>
            <Icon
              name="arrow-forward"
              size={14}
              className="text-stone transition-transform duration-fast group-hover:-translate-x-1 group-hover:text-cobalt"
            />
          </Link>
        </div>
      </PageContainer>

      {/* Infinite Seamless Moving Editorial Brand Marquee */}
      <div className="relative mt-2 w-full overflow-hidden">
        <div
          role="region"
          aria-label={m.homeBrandsTitle}
          className="marquee marquee-mask relative w-full overflow-hidden py-3"
        >
          <div className="marquee-track flex w-max items-center">
            {/* First Set: Accessible, keyboard-focusable */}
            <div className="flex items-center">
              {displayBrands.map((brand, idx) => (
                <div key={`brand-1-${brand.slug}`} className="flex items-center">
                  <Link
                    href={`${routes.products}?brand=${encodeURIComponent(brand.slug)}`}
                    className="group flex w-48 shrink-0 flex-col items-center justify-center px-4 py-3 text-center transition-all duration-fast hover:-translate-y-0.5 sm:w-56 sm:px-6 lg:w-64"
                  >
                    <div className="flex min-h-[40px] items-center justify-center">
                      {brand.renderWordmark()}
                    </div>
                    <span className="mt-2 text-11 font-display text-stone opacity-75 transition-opacity duration-fast group-hover:opacity-100">
                      {brand.subtitleAr}
                    </span>
                  </Link>
                  <div className="h-8 w-px shrink-0 bg-line/60" aria-hidden="true" />
                </div>
              ))}
            </div>

            {/* Second Set: Cloned for seamless wrap-around loop (Hidden from screen readers & keyboard focus) */}
            <div className="flex items-center" aria-hidden="true">
              {displayBrands.map((brand, idx) => (
                <div key={`brand-2-${brand.slug}`} className="flex items-center">
                  <Link
                    href={`${routes.products}?brand=${encodeURIComponent(brand.slug)}`}
                    tabIndex={-1}
                    className="group flex w-48 shrink-0 flex-col items-center justify-center px-4 py-3 text-center transition-all duration-fast hover:-translate-y-0.5 sm:w-56 sm:px-6 lg:w-64"
                  >
                    <div className="flex min-h-[40px] items-center justify-center">
                      {brand.renderWordmark()}
                    </div>
                    <span className="mt-2 text-11 font-display text-stone opacity-75 transition-opacity duration-fast group-hover:opacity-100">
                      {brand.subtitleAr}
                    </span>
                  </Link>
                  <div className="h-8 w-px shrink-0 bg-line/60" aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
