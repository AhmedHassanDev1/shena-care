import type { CartItem } from '@/lib/cart';

/**
 * Changes the customer has to see before checkout (CommerceStates §١ «قبل إتمام الطلب»): a price that changed since
 * the line was added, and a line that can no longer be ordered. A price change is reviewed once («تمام، كمّل» /
 * «راجعت، كمّل») and stays reviewed for that new price in this tab; an unavailable line can only be removed
 * (the server refuses to quote it). The API has no "price change acknowledged" call, so the review is kept here.
 */
const STORAGE_KEY = 'shena.cartReviewed';

const priceKey = (item: Pick<CartItem, 'skuId' | 'price'>) => `${item.skuId}@${item.price?.amount ?? 'none'}`;

function read(): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function reviewedPrices(): Set<string> {
  return read();
}

export function markPricesReviewed(items: Pick<CartItem, 'skuId' | 'price'>[]): Set<string> {
  const next = read();
  for (const item of items) next.add(priceKey(item));
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Without storage the review lasts for this page only.
  }
  return next;
}

export function needsPriceReview(item: CartItem, reviewed: Set<string>): boolean {
  return item.canOrder && item.priceChangedSinceAdd && item.priceAtAdd !== null && !reviewed.has(priceKey(item));
}

/** Lines that still need the customer's decision before checkout can start. */
export function pendingChanges(items: CartItem[], reviewed: Set<string>) {
  const priceChanged = items.filter((item) => needsPriceReview(item, reviewed));
  const unavailable = items.filter((item) => !item.canOrder);
  return { priceChanged, unavailable, count: priceChanged.length + unavailable.length };
}
