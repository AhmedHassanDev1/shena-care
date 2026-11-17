'use client';

import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { ArrowLink } from '@/components/ui/arrow-link';
import { apiClient } from '@/lib/api-client';
import { canOptimizeImage, resolveImageUrl } from '@/lib/images';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';

/** The slice of `GET /brands/:slug` (catalog-owned, public) the line page reads: brand identity and its lines. */
interface BrandRecord {
  name: string;
  slug: string;
  logoUrl: string | null;
  productLines: Array<{ slug: string; name: string; description: string | null; imageUrl: string | null; isActive: boolean }>;
}

export interface BrandLineHeaderProps {
  lineSlug: string;
  /** Brand the line's products carry (from the discovery brand facet: a line belongs to exactly one brand). */
  brand: { slug: string; name: string } | undefined;
  /** Line display name from the discovery line facet; shown while the brand record loads. */
  lineName: string | undefined;
  total: number | null;
}

/**
 * Compact Brand Line header (reusable for any ProductLine): brand identity (official logo when the catalog has one,
 * otherwise the brand name in type), the line name, the line's own image and description only when the catalog stores
 * them, and a link to the whole brand. Products below are the normal listing narrowed by `productLine`; a line is
 * never a category or a concern.
 */
export function BrandLineHeader({ lineSlug, brand, lineName, total }: BrandLineHeaderProps) {
  const m = useMessages();
  const locale = useLocale();
  const record = useQuery({
    queryKey: ['brands', 'record', brand?.slug],
    queryFn: () => apiClient.get<BrandRecord>(`/brands/${encodeURIComponent(brand!.slug)}`),
    enabled: Boolean(brand),
    staleTime: 10 * 60 * 1000,
  }).data;
  const line = record?.productLines.find((l: BrandRecord['productLines'][number]) => l.slug === lineSlug);
  const name = line?.name ?? lineName ?? lineSlug;
  const brandName = record?.name ?? brand?.name;
  const logo = resolveImageUrl(record?.logoUrl);
  const image = resolveImageUrl(line?.imageUrl);
  const description = line?.description?.trim();

  return (
    <div className="flex items-center gap-4 lg:gap-5">
      {image ? (
        <span className="relative size-20 flex-none overflow-hidden rounded-image bg-sand/40 lg:size-24">
          <Image src={image} alt="" fill sizes="96px" unoptimized={!canOptimizeImage(image)} className="object-cover" />
        </span>
      ) : null}
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {brandName ? (
            logo ? (
              <Image src={logo} alt={brandName} width={128} height={20} unoptimized={!canOptimizeImage(logo)} className="h-5 w-auto max-w-32 object-contain" />
            ) : (
              <bdi className="font-serif text-20 italic text-cobalt">{brandName}</bdi>
            )
          ) : null}
          <span className="text-12.5 font-semibold text-stone">{m.plpLineLabel}</span>
        </div>
        <h1 id="plp-h" className="m-0 text-28 font-bold leading-tight text-ink md:text-34">
          <bdi>{name}</bdi>
        </h1>
        <p className="m-0 text-14.5 leading-22 text-stone">
          {description ?? (brandName && total !== null ? fillMessage(m.plpLineBody, { n: fillMessage(m.plpCount, { n: formatNumber(total, locale) }), brand: brandName }) : null)}
        </p>
        {brand ? (
          <ArrowLink href={routes.productsByBrand(brand.slug)} className="text-14">
            {fillMessage(m.plpLineAllBrand, { brand: brandName ?? brand.name })}
          </ArrowLink>
        ) : null}
      </div>
    </div>
  );
}
