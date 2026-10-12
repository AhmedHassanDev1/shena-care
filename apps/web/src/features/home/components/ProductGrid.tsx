import { ProductCard } from './ProductCard';
import type { ProductCardModel } from '../lib/products';

/** Two columns on phones, widening with the viewport. */
export function ProductGrid({ products }: { products: ProductCardModel[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.id} className="flex">
          <ProductCard product={product} priority={index < 2} />
        </li>
      ))}
    </ul>
  );
}
