import { ProductCard } from './ProductCard';
import type { ProductCardModel } from '../lib/products';

/** Two columns on phones, three from tablet, four from desktop. Vertical gaps exceed horizontal ones so each card reads as a column. */
export function ProductGrid({ products }: { products: ProductCardModel[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 lg:gap-y-8">
      {products.map((product, index) => (
        <li key={product.id} className="flex">
          <ProductCard product={product} priority={index < 2} />
        </li>
      ))}
    </ul>
  );
}
