import type { CartItem } from '@/lib/cart';

/**
 * What the page the customer returns to after sign-in shows (Addendum §Checkout interruption and return):
 *  - `signed-in`: the toast «دخلت بحسابك. كمّل طلبك من مكان ما وقفت.» on the returned page;
 *  - `cart-merged`: adoption changed the cart, so the cart opens first with «سلتك اتجمعت…» + «راجع السلة».
 * One-shot, this tab only: the receiving page consumes it once.
 */
export type AuthReturn = 'signed-in' | 'cart-merged';

const STORAGE_KEY = 'shena.authReturn';

export function markAuthReturn(kind: AuthReturn): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, kind);
  } catch {
    // No storage: the customer still lands on the right page, only without the notice.
  }
}

/** Reads and clears the pending notice when it is of `kind`. */
export function consumeAuthReturn(kind: AuthReturn): boolean {
  try {
    if (sessionStorage.getItem(STORAGE_KEY) !== kind) return false;
    sessionStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether sign-in changed the cart the customer saw before it (the account already held items, or quantities merged).
 * The API has no "changed by adoption" signal yet (Addendum §API dependencies, needs confirmation), so the lines are
 * compared before and after: same SKUs with the same quantities means unchanged.
 */
export function cartChangedByAdoption(
  before: Pick<CartItem, 'skuId' | 'quantity'>[],
  after: Pick<CartItem, 'skuId' | 'quantity'>[]
): boolean {
  if (before.length !== after.length) return true;
  const quantities = new Map(before.map((line) => [line.skuId, line.quantity]));
  return after.some((line) => quantities.get(line.skuId) !== line.quantity);
}
