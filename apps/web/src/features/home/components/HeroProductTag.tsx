'use client';

import Link from 'next/link';
import { ProductTile } from '@/components/ui/product-tile';
import { toCardModel } from '@/features/catalog/lib/card-model';
import { currencyLabel, formatAmount } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { useHomeProducts } from '../hooks/useHomeProducts';

/**
 * A glass tag over the hero photograph for one real catalog product: its own packshot, brand, name and price, linking to
 * its page. It exists only when the catalog returns a sellable product with a photo and a price; with none it renders
 * nothing (never a drawn stand-in).
 */
export function HeroProductTag() {
  const t = useMessages();
  const locale = useLocale();
  const { data } = useHomeProducts();
  const product = (data?.items ?? [])
    .map((p) => toCardModel(p, locale))
    .find((p) => p.imageUrl && p.price);
  if (!product || !product.imageUrl || !product.price) return null;

  return (
    <Link
      href={routes.product(product.slug)}
      className="hero-rise group absolute end-4 top-4 z-10 flex w-60 items-center gap-3 rounded-card bg-linen p-2.5 text-ink no-underline shadow-e2 backdrop-blur-xl transition-transform duration-base ease-standard hover:-translate-y-0.5 lg:bottom-8 lg:end-8 lg:top-auto lg:w-72 lg:p-3"
      style={{ animationDelay: '700ms' }}
    >
      <ProductTile src={product.imageUrl} alt="" name={product.name} size="thumb" sizes="64px" className="size-14 flex-none lg:size-16" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-11 font-semibold leading-13 text-stone">{t.homeHeroTagLabel}</span>
        <span lang="en" dir="ltr" className="truncate font-serif italic text-13 leading-13 text-stone text-match-parent">
          {product.brandName.toUpperCase()}
        </span>
        <span dir="auto" className="truncate text-13 font-semibold leading-18 text-match-parent text-ink">
          {product.name}
        </span>
        <span className="text-13 font-bold leading-18 tabular-nums text-ink">
          <bdi>{formatAmount(product.price.amount, locale)}</bdi> <span className="text-11 font-medium text-stone">{currencyLabel(locale)}</span>
        </span>
      </span>
    </Link>
  );
}
