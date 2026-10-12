'use client';

import Link from 'next/link';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { formatEgp, formatPackSize } from '@/lib/i18n/format';
import { routes } from '@/lib/routes';
import type { ProductCardModel } from '../lib/products';
import { ProductImage } from './ProductImage';
import { QuickAdd } from './QuickAdd';

/** One product: image with Quick Add, brand, name, pack size and the catalog price in EGP. */
export function ProductCard({ product, priority = false }: { product: ProductCardModel; priority?: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  const amount = product.price ? formatEgp(product.price.amount, product.price.currency, locale) : null;
  const priceText = amount ? (product.priceIsFrom ? fillMessage(m.productPriceFrom, { price: amount }) : amount) : null;
  const size = formatPackSize(product.size, product.sizeUnit, locale);

  return (
    <article className="relative flex w-full flex-col overflow-hidden rounded-md border border-border bg-card shadow-raised">
      <div className="relative aspect-[4/5]">
        {/* Bottom inset leaves room for the Quick Add overlay so it never covers the packshot. */}
        <div className="absolute inset-x-3 bottom-14 top-3">
          <ProductImage src={product.imageUrl} alt={product.imageAlt} priority={priority} />
        </div>
        {product.action.kind === 'unavailable' ? (
          <p className="absolute inset-x-2 bottom-2 flex h-11 items-center justify-center rounded-md bg-muted text-support text-muted-foreground">
            {m.productUnavailable}
          </p>
        ) : null}
        <QuickAdd product={product} />
      </div>

      <div className="flex flex-1 flex-col gap-0.5 px-3 pb-3 pt-1">
        <p className="truncate text-caption text-muted-foreground">
          <bdi>{product.brandName}</bdi>
        </p>
        <h3
          dir="auto"
          // dir=auto lets a Latin name wrap and clamp as LTR text; match-parent keeps it on the same edge as the Arabic ones.
          className="line-clamp-2 min-h-[3.6em] text-support font-semibold text-foreground [text-align:match-parent]"
        >
          {/* The link stretches over the whole card; Quick Add sits above it (z-10). */}
          <Link href={routes.product(product.slug)} className="after:absolute after:inset-0 focus-visible:outline-offset-[-3px]">
            {product.name}
          </Link>
        </h3>
        <p className="min-h-[1.5em] text-caption text-muted-foreground">{size ? <bdi>{size}</bdi> : null}</p>
        <p className="mt-auto pt-1 text-body font-semibold tabular-nums text-foreground">
          {priceText ?? (
            <span className="text-support font-normal text-muted-foreground">{m.productPriceUnavailable}</span>
          )}
        </p>
      </div>
    </article>
  );
}
