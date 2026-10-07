'use client';

import Link from 'next/link';
import { useProducts } from '@/features/catalog/queries/catalog.queries';
import { ProductCard } from '@/features/catalog/ui/ProductCard';
import { Skeleton } from '@/components/ui/skeleton';

export function PopularSolutions() {
  const { data: products, isLoading, isError } = useProducts();

  const displayProducts = products?.filter((product) => product.skus.some((sku) => sku.price)).slice(0, 5) || [];

  return (
    <section className="home-section">
      <div className="section-heading">
        <div><h2>Popular Solutions</h2><p>Top-rated products for your beauty goals.</p></div>
        <Link href="/products">
          View All <span className="ml-1">→</span>
        </Link>
      </div>

      <div className="product-card-row">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="product-loading-card">
              <Skeleton className="w-full h-[118px] rounded-none" />
              <div className="p-3 space-y-2">
                <Skeleton className="w-20 h-3" />
                <Skeleton className="w-full h-4" />
                <Skeleton className="w-12 h-4" />
              </div>
            </div>
          ))
        ) : isError ? (
          <div className="product-state">We couldn&apos;t load products right now. <Link href="/products">Browse the catalog</Link></div>
        ) : displayProducts.length === 0 ? (
          <div className="product-state">No published products are available yet.</div>
        ) : (
          displayProducts.map((product) => (
            <ProductCard key={product.id} product={product} locale="en" variant="home" />
          ))
        )}
      </div>
    </section>
  );
}
