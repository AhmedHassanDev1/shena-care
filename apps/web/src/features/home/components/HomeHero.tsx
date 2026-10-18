import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import type { CardModel } from '@/features/catalog/lib/card-model';
import type { Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { HeroProduct } from './HeroProduct';

/**
 * Season campaign (Main / Mobile hero). Sahel-blue field with shutter light, Beiruti headline, one Instrument Serif
 * campaign line, copy and CTAs, «ماركات في المختارات», and a photo panel with the shoppable product.
 * Photography: there is no licensed campaign photo (README §Assets), so the panel shows the featured product's own
 * catalog image on the shared sand stage, and the pinned print shows the second pick — real catalog media only.
 */
export function HomeHero({ m, feature, second, brands }: { m: Messages; feature: CardModel | null; second: CardModel | null; brands: string[] }) {
  const [line1, line2] = m.heroTitle.split('|');
  const brandList = (className: string) =>
    brands.length ? (
      <ul lang="en" dir="ltr" className={cn('m-0 flex list-none flex-wrap justify-end p-0 font-semibold', className)}>
        {brands.map((brand) => (
          <li key={brand}>{brand}</li>
        ))}
      </ul>
    ) : null;

  return (
    <section aria-label={m.heroLabel}>
      {/* Desktop */}
      <div className="field-sahel shutter-light warm hidden min-h-[640px] flex-wrap rounded-sheet shadow-elevation-3 lg:flex">
        <div className="flex flex-[0_1_540px] flex-col gap-5 px-14 pb-12 pt-18">
          <div className="flex items-center gap-3 text-12 font-semibold leading-17">
            <span>{m.heroEyebrow}</span>
            <span aria-hidden="true" className="h-[1.5px] w-18 bg-bone/55" />
          </div>
          <h1 className="m-0 text-display-hero">
            {line1}
            <br />
            {line2}
          </h1>
          <p lang="en" dir="ltr" className="m-0 text-campaign opacity-95 text-match-parent">
            {m.heroCampaign}
          </p>
          <p className="m-0 max-w-[360px] text-15 leading-27">{m.heroBody}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href={routes.products}
              className="inline-flex h-12.5 items-center gap-2.5 rounded-pill bg-linen px-6.5 text-15.5 font-semibold text-night no-underline shadow-elevation-2 hover:bg-bone"
            >
              <span>{m.heroCta}</span>
              <Icon name="arrow-forward" size={18} />
            </Link>
            <Link href={routes.products} className="text-link text-15 text-bone hover:text-bone">
              {m.heroAllBrands}
            </Link>
          </div>
          {brands.length ? (
            <div className="mt-4 flex flex-col gap-2 pt-5 shadow-hairline-on-blue">
              <span className="text-12 font-semibold leading-17 opacity-90">{m.heroBrandsLabel}</span>
              {brandList('max-w-[300px] self-start gap-x-3.5 gap-y-1.5 text-11 leading-16 tracking-brand')}
            </div>
          ) : null}
        </div>

        {feature ? (
          <div className="relative min-h-[520px] flex-[1_1_460px] py-5 pe-24 ps-5">
            <div className="relative h-full min-h-[600px] overflow-hidden rounded-card shadow-elevation-3">
              <ProductTile src={feature.imageUrl} alt={feature.imageAlt} name={feature.name} priority className="absolute inset-0 aspect-auto rounded-none" sizes="560px" />
            </div>
            {second ? (
              <Link
                href={routes.product(second.slug)}
                aria-label={`${second.brandName} ${second.name}`}
                className="absolute end-[30px] top-16 z-10 h-56 w-44 -rotate-[4deg] rounded-16 bg-linen p-[7px] shadow-elevation-3 ltr:rotate-[4deg]"
              >
                <ProductTile src={second.imageUrl} alt="" name={second.name} className="h-full rounded-10" sizes="176px" />
              </Link>
            ) : null}
            <div className="absolute -start-[150px] bottom-10 z-10">
              <HeroProduct product={feature} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Phone */}
      <div className="lg:hidden">
        <div className="field-sahel shutter-light warm relative h-[436px] rounded-sheet shadow-elevation-3">
          <div className="flex flex-col gap-1.5 px-5.5 pt-5">
            <span className="text-12 font-semibold leading-17">{m.heroEyebrow}</span>
            <h1 className="m-0 font-display text-40 font-extrabold leading-42">
              {line1}
              <br />
              {line2}
            </h1>
            <p lang="en" dir="ltr" className="m-0 font-serif text-20 italic leading-24 text-match-parent">
              {m.heroCampaign}
            </p>
          </div>
          {feature ? (
            <div className="absolute inset-x-3 bottom-3 top-[168px] overflow-hidden rounded-18 shadow-elevation-3">
              <ProductTile src={feature.imageUrl} alt={feature.imageAlt} name={feature.name} priority className="absolute inset-0 aspect-auto rounded-none" sizes="100vw" />
              <div className="absolute inset-x-2 bottom-2">
                <HeroProduct product={feature} compact />
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Link
            href={routes.products}
            className="flex h-12.5 flex-1 items-center justify-center gap-2.5 rounded-pill bg-blue text-15 font-semibold text-white no-underline shadow-action"
          >
            <span>{m.heroCtaMobile}</span>
            <Icon name="arrow-forward" size={18} />
          </Link>
          <Link href={routes.products} className="flex h-12.5 flex-none items-center rounded-pill bg-linen px-4.5 text-15 font-semibold text-night no-underline shadow-outline-night">
            {m.heroAllBrands}
          </Link>
        </div>
        {brands.length ? (
          <div className="mt-3 flex items-baseline gap-2.5">
            <span className="flex-none text-12 font-semibold leading-17 text-ink-2">{m.heroBrandsLabelMobile}</span>
            {brandList('min-w-0 flex-1 gap-x-3 gap-y-0.5 text-10.5 leading-16 tracking-brand text-night')}
          </div>
        ) : null}
      </div>
    </section>
  );
}
