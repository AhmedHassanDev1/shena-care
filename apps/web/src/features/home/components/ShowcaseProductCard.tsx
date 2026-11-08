import { ProductCard, ProductCardSkeleton } from '@/features/catalog/components/ProductCard';
import type { CardModel } from '@/features/catalog/lib/card-model';

export interface ShowcaseProductCardProps {
  product: CardModel;
  priority?: boolean;
}

/** Home and catalog share the same product presentation and commerce behavior. */
export function ShowcaseProductCard({ product, priority = false }: ShowcaseProductCardProps) {
  return <ProductCard product={product} priority={priority} feature />;
}

export function ShowcaseProductCardSkeleton() {
  return <ProductCardSkeleton />;
}
