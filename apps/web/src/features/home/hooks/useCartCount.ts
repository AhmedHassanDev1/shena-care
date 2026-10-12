'use client';

import { useCart } from '@/features/cart/hooks/useCart';

/** Item count for cart badges. Unknown (loading or failed) is 0 so the badge simply stays hidden. */
export function useCartCount(): number {
  const { cart } = useCart();
  return cart?.itemCount ?? 0;
}
