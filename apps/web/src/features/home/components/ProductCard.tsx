'use client';

import Link from 'next/link';
import { ProductNiche } from '@/components/ui/product-niche';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { formatEgp, formatPackSize } from '@/lib/i18n/format';
import { routes } from '@/lib/routes';
import type { ProductCardModel } from '../lib/products';
import { ProductImage } from './ProductImage';
import { QuickAdd } from './QuickAdd';

/**
 * One product, in the design system's browsing order: arch niche → brand → name → size → price + add.
 * The name's link stretches over the whole card; Quick Add sits above it.
 */
export function ProductCard({ product, priority = false }: { product: ProductCardModel; priority?: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  const amount = product.price ? formatEgp(product.price.amount, product.price.currency, locale) : null;
  const priceText = amount ? (product.priceIsFrom ? fillMessage(m.productPriceFrom, { price: amount }) : amount) : null;
  const size = formatPackSize(product.size, product.sizeUnit, locale);

  return (
    <article className="group relative flex w-full min-w-0 flex-col gap-2">
      <ProductNiche className="group-hover:bg-sand-deep">
        <ProductImage src={product.imageUrl} alt={product.imageAlt} priority={priority} />
      </ProductNiche>

      <div className="flex flex-1 flex-col gap-0.5 px-0.5">
        <p className="truncate text-caption text-ink-soft">
          <bdi>{product.brandName}</bdi>
        </p>
        <h3
          dir="auto"
          // dir=auto lets a Latin name wrap and clamp as LTR text; match-parent keeps it on the same edge as the Arabic ones.
          className="line-clamp-2 min-h-12 text-body text-foreground [text-align:match-parent]"
        >
          <Link href={routes.product(product.slug)} className="stretched-link">
            {product.name}
          </Link>
        </h3>
        <p className="min-h-5 text-body-s text-ink-subtle">{size ? <bdi>{size}</bdi> : null}</p>
        <div className="mt-auto flex min-h-control-m flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1">
          <p className="text-price tabular-nums text-foreground">
            {priceText ?? <span className="text-body-s font-normal text-ink-subtle">{m.productPriceUnavailable}</span>}
          </p>
          {product.action.kind === 'unavailable' ? (
            <p className="text-body-s text-ink-subtle">{m.productUnavailable}</p>
          ) : (
            <QuickAdd product={product} />
          )}
        </div>
      </div>
    </article>
  );
}
