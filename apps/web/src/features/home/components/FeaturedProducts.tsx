import { getProducts } from '@/features/catalog/api/products';
import type { ProductView } from '@/features/catalog/api/products';
import { Skeleton } from '@/components/ui/skeleton';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { selectFeaturedProducts } from '../lib/products';
import { ProductGrid } from './ProductGrid';
import { RefreshButton } from './RefreshButton';
import { SectionHeader } from './SectionHeader';

/** Eight cards fill two desktop rows of four and four phone rows of two. */
const FEATURED_COUNT = 8;

/**
 * Real catalog products. GET /products only returns published products that have media and at least
 * one orderable, priced SKU, so everything shown here can actually be bought.
 */
export async function FeaturedProducts() {
  const m = getMessages(getLocale());

  let products: ProductView[] | null = null;
  try {
    products = await getProducts(FEATURED_COUNT);
  } catch (error) {
    console.error('Home: failed to load products', error);
  }

  return (
    <section aria-labelledby="home-products">
      <SectionHeader
        id="home-products"
        title={m.productsTitle}
        subtitle={m.productsSubtitle}
        href={routes.products}
        linkLabel={m.viewAll}
      />
      {products === null ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-border bg-card p-5">
          <p className="text-body text-foreground">{m.productsError}</p>
          <RefreshButton label={m.tryAgain} />
        </div>
      ) : products.length === 0 ? (
        <p className="rounded-md border border-border bg-card p-5 text-body text-muted-foreground">{m.productsEmpty}</p>
      ) : (
        <ProductGrid products={selectFeaturedProducts(products, FEATURED_COUNT)} />
      )}
    </section>
  );
}

export function FeaturedProductsSkeleton() {
  return (
    <section aria-busy="true" aria-label={getMessages(getLocale()).loading}>
      <Skeleton className="mb-4 h-7 w-44 lg:mb-6" />
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index}>
            <Skeleton className="aspect-[4/5] w-full" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-2 h-4 w-1/2" />
          </li>
        ))}
      </ul>
    </section>
  );
}
