'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api-client';
import { canOptimizeImage } from '@/lib/images';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { BRAND_LOGOS } from '../lib/brand-logos';

/** The public brand record (GET /brands, active brands only); the marquee uses the identity and logo fields. */
interface BrandRecord {
  slug: string;
  name: string;
  isActive: boolean;
  logoUrl: string | null;
  logoMetadata: { width?: number; height?: number } | null;
}

interface MarqueeBrand {
  slug: string;
  name: string;
  logo: { src: string; width: number; height: number } | null;
}

/** One group must be wider than the widest screen, or the loop shows a gap; brands repeat until it has this many logos. */
const MIN_PER_GROUP = 12;

/** Logos share an optical size: wide wordmarks are set lower than compact, near-square marks. */
function logoHeight({ width, height }: { width: number; height: number }) {
  const ratio = width / height;
  return ratio < 1.6 ? 44 : ratio < 3 ? 36 : 28;
}

function BrandItem({ brand, hidden }: { brand: MarqueeBrand; hidden: boolean }) {
  return (
    <li className={hidden ? 'flex-none motion-reduce:hidden' : 'flex-none'} aria-hidden={hidden || undefined}>
      <Link
        href={`${routes.products}?brand=${encodeURIComponent(brand.slug)}`}
        tabIndex={hidden ? -1 : undefined}
        className="flex h-16 items-center px-8 opacity-60 grayscale transition-[opacity,filter] duration-base ease-standard hover:opacity-100 hover:grayscale-0 focus-visible:opacity-100 focus-visible:grayscale-0 lg:px-10"
      >
        {brand.logo ? (
          <Image
            src={brand.logo.src}
            alt={hidden ? '' : brand.name}
            width={brand.logo.width}
            height={brand.logo.height}
            unoptimized={!canOptimizeImage(brand.logo.src)}
            sizes="200px"
            className="w-auto max-w-none object-contain"
            style={{ height: logoHeight(brand.logo) }}
          />
        ) : (
          <span lang="en" dir="ltr" className="whitespace-nowrap font-serif italic text-16 text-ink">
            {brand.name.toUpperCase()}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Brand marquee: the catalog's active brands (GET /brands), each with the logo the catalog holds for it (`logoUrl`) or,
 * failing that, the official mark kept in brand-logos.ts, or its name in type. Logos are monochrome until hovered or
 * focused. The loop is two identical groups moved by exactly one group width (.marquee-* in globals.css), so it never
 * jumps. It pauses on hover, on focus and from the pause button (WCAG 2.2.2), runs the other way in RTL, and under
 * prefers-reduced-motion becomes a plain scrollable row. A failed request says so and offers a retry.
 */
export function BrandMarquee() {
  const m = useMessages();
  const [paused, setPaused] = useState(false);
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['brands', 'public'],
    queryFn: () => apiClient.get<BrandRecord[]>('/brands'),
    staleTime: 5 * 60 * 1000,
  });

  const brands: MarqueeBrand[] = (data ?? [])
    .filter((b) => b.isActive)
    .map((b) => ({
      slug: b.slug,
      name: b.name,
      logo: b.logoUrl ? { src: b.logoUrl, width: b.logoMetadata?.width ?? 160, height: b.logoMetadata?.height ?? 48 } : (BRAND_LOGOS[b.slug] ?? null),
    }));

  const repeats = Math.max(1, Math.ceil(MIN_PER_GROUP / Math.max(brands.length, 1)));
  const group = Array.from({ length: repeats }, (_, r) => brands.map((brand) => ({ brand, hidden: r > 0 }))).flat();

  return (
    <section aria-labelledby="home-brands-title" className="border-y border-line bg-linen/50 py-6 lg:py-8">
      <PageContainer className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-cobalt" />
          <h2 id="home-brands-title" className="m-0 font-display text-14 font-bold tracking-wide text-ink sm:text-15">
            {m.homeBrandsLabel}
          </h2>
          <span className="hidden font-serif italic text-13 text-stone sm:inline">
            · Authorized Partners
          </span>
        </div>
        <div className="flex items-center gap-4">
          {brands.length > 0 ? (
            <button
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused((p) => !p)}
              className="inline-flex min-h-10 items-center gap-1.5 text-12 font-semibold text-stone transition-colors duration-fast ease-standard hover:text-ink motion-reduce:hidden"
            >
              <Icon name={paused ? 'play' : 'pause'} size={14} strokeWidth={2} />
              {paused ? m.homeBrandsPlay : m.homeBrandsPause}
            </button>
          ) : null}
          <Link href={routes.products} className="inline-flex min-h-10 items-center gap-1 font-serif italic text-14 font-bold text-cobalt transition-colors hover:text-ink">
            <span>{m.homeBrandsAll}</span>
            <Icon name="arrow-forward" size={14} />
          </Link>
        </div>
      </PageContainer>

      {isError ? (
        <PageContainer className="flex flex-wrap items-center justify-between gap-3 py-2 text-14 text-tomato-ink" role="alert">
          <span>{m.homeBrandsError}</span>
          <Button variant="linen" size="s" loading={isFetching} onClick={() => refetch()}>
            {m.tryAgain}
          </Button>
        </PageContainer>
      ) : isPending ? (
        <PageContainer aria-busy="true">
          <Skeleton className="h-16 w-full rounded-card bg-line" />
        </PageContainer>
      ) : brands.length === 0 ? null : (
        <div className="marquee marquee-mask overflow-hidden motion-reduce:overflow-x-auto" data-paused={paused}>
          <div className="marquee-track flex w-max motion-reduce:animate-none">
            {[0, 1].map((g) => (
              <ul key={g} aria-hidden={g === 1 || undefined} className={`m-0 flex flex-none list-none items-center p-0 ${g === 1 ? 'motion-reduce:hidden' : ''}`}>
                {group.map(({ brand, hidden }, i) => (
                  <BrandItem key={`${brand.slug}-${i}`} brand={brand} hidden={hidden || g === 1} />
                ))}
              </ul>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
