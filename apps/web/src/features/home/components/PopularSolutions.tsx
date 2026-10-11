'use client';

import Link from 'next/link';
import { PackageOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProducts } from '@/features/catalog/queries/catalog.queries';
import { ProductCard, ProductCardSkeleton } from '@/features/catalog/ui/ProductCard';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { SectionHeading } from './SectionHeading';

const VISIBLE = 4;

/** First priced products from the live catalog. No popularity claim: there is no ranking data yet. */
export function PopularSolutions() {
  const locale = useLocale();
  const m = useMessages();
  const { data, isLoading, isError, refetch, isRefetching } = useProducts();
  const products = (data ?? []).filter((product) => product.skus.some((sku) => sku.price)).slice(0, VISIBLE);

  return (
    <section aria-labelledby="catalog-title" aria-busy={isLoading || undefined} className="pt-12 md:pt-16">
      <SectionHeading
        id="catalog-title"
        title={m.catalogTitle}
        subtitle={m.catalogSubtitle}
        action={products.length > 0 ? { href: routes.products, label: m.viewAll } : undefined}
      />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-7 md:gap-x-5 lg:grid-cols-4">
          {Array.from({ length: VISIBLE }).map((_, index) => (
            <ProductCardSkeleton key={index} />
          ))}
        </div>
      ) : isError ? (
        <div role="alert" className="flex flex-col items-start gap-4 rounded-md border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-support text-foreground">{m.productsLoadError}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} loading={isRefetching}>
              {!isRefetching ? <RefreshCw aria-hidden="true" /> : null}
              {m.tryAgain}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={routes.products}>{m.browseCatalog}</Link>
            </Button>
          </div>
        </div>
      ) : products.length === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-dashed border-input bg-card p-5">
          <PackageOpen aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <p className="text-support text-muted-foreground">{m.noPublishedProducts}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-7 md:gap-x-5 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} locale={locale} variant="home" />
          ))}
        </div>
      )}
    </section>
  );
}
