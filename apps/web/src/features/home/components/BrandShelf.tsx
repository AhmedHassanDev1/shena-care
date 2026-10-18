import Link from 'next/link';
import { SectionHeader } from '@/components/ui/section-header';
import type { Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import type { HomeBrand } from '../home-data';

/**
 * «ماركات الصيدلية، على رف واحد» (Main brands grid, Mobile brands rail): every brand with sellable products, as
 * linen tiles with the brand in tracked Latin caps and its department(s) underneath. Brands come from the discovery
 * facets — only brands a customer can actually buy from.
 */
export function BrandShelf({ m, brands }: { m: Messages; brands: HomeBrand[] }) {
  if (!brands.length) return null;
  const areaLabel = (area: HomeBrand['area']) => (area === 'skin' ? m.brandSkin : area === 'hair' ? m.brandHair : area === 'both' ? m.brandBoth : null);
  return (
    <section aria-labelledby="brands-h">
      <SectionHeader
        id="brands-h"
        title={
          <>
            <span className="lg:hidden">{m.navBrands}</span>
            <span className="max-lg:hidden">{m.brandsTitle}</span>
          </>
        }
        description={<span className="max-lg:hidden">{m.brandsBody}</span>}
        link={{ href: routes.products, label: m.brandsAll }}
        className="mb-5"
      />
      <ul className="-mx-4 m-0 flex list-none snap-x gap-4 overflow-x-auto px-4 pb-2 scrollbar-none lg:mx-0 lg:flex-wrap lg:overflow-visible lg:p-0">
        {brands.map((brand) => {
          const area = areaLabel(brand.area);
          return (
            <li key={brand.slug} className="w-[150px] flex-none snap-start lg:w-auto lg:min-w-0 lg:flex-[1_1_260px]">
              <Link
                href={`${routes.products}?brand=${encodeURIComponent(brand.slug)}`}
                className="flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-card bg-linen px-3 text-night no-underline shadow-tile-hairline transition-transform duration-base ease-standard motion-safe:hover:-translate-y-[3px] lg:h-24"
              >
                <span lang="en" dir="ltr" className="max-w-full truncate text-15 font-semibold leading-18 tracking-brand">
                  {brand.name.toUpperCase()}
                </span>
                {area ? <span className="text-12 leading-17 text-ink-2">{area}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
