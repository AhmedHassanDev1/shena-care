import { apiClient } from './api-client';
import { auth } from './auth';
import type { ProductView } from '@/features/catalog/api/products';

/** Cart as the screens consume it: backend cart lines joined with catalog display data. */
export interface CartItem {
  skuId: string;
  quantity: number;
  /** Backend verdict for this line right now (sellable and available). */
  canOrder: boolean;
  /** Price when the line was added, and whether the current backend price differs (change receipt). */
  priceAtAdd: number | null;
  priceChangedSinceAdd: boolean;
  sku: {
    id: string;
    code: string;
    variantName: string;
    size: number | null;
    sizeUnit: string | null;
    product: {
      id: string;
      name: string;
      slug: string;
      brand: {
        name: string;
      };
      /** Merchandising category, for the product-type line under the name (CartD). */
      category: { slug: string; name: string } | null;
    };
    /** Primary catalog image for display; null when the catalog has none. */
    image: { url: string; alt: string } | null;
  };
  price: {
    amount: number;
    currency: string;
  } | null;
  subtotal: number | null;
}

export interface Cart {
  /** Cart id; empty string when no cart exists yet. */
  sessionId: string;
  revision: number;
  items: CartItem[];
  total: number;
  itemCount: number;
}

/**
 * Cart exactly as `GET/POST /ordering/cart*` returns it (apps/api cart.service.ts `CartDetail`).
 * Lines carry only the SKU id and money; product names and brands come from the catalog.
 */
export interface BackendCartItem {
  id: string;
  skuId: string;
  quantity: number;
  price: number | null;
  priceAtAdd: number | null;
  priceChangedSinceAdd: boolean;
  canOrder: boolean;
  availability: 'available' | 'unavailable';
  lineTotal: number;
}

export interface BackendCart {
  id: string | null;
  ownerType: 'customer' | 'guest';
  revision: number;
  items: BackendCartItem[];
  totalAmount: number;
  guestCartToken?: string;
}

export interface ReorderItemResult {
  skuId: string;
  productName: string | null;
  variantName: string | null;
  requestedQuantity: number;
  addedQuantity: number;
  price: number | null;
  status: 'added' | 'partially_added' | 'unavailable' | 'quantity_limit_reached' | 'cart_full';
  reason?: string;
}

export interface ReorderResult {
  cart: Cart;
  added: ReorderItemResult[];
  skipped: ReorderItemResult[];
  summary: {
    totalRequested: number;
    totalAdded: number;
    totalSkipped: number;
  };
}

export interface BackendReorderResult {
  cart: BackendCart;
  added: ReorderItemResult[];
  skipped: ReorderItemResult[];
  summary: {
    totalRequested: number;
    totalAdded: number;
    totalSkipped: number;
  };
}

/** Per-line quantity limit of the cart contract (apps/api cart.service.ts MAX_LINE_QUANTITY; AddToCartDto @Max(20)). */
export const MAX_LINE_QUANTITY = 20;

const CART_TOKEN_KEY = 'guestCartToken';
/** Backend prices are EGP; used only when a SKU can no longer be found in the catalog. */
const FALLBACK_CURRENCY = 'EGP';

function getCartOptions() {
  const token = auth.getToken();
  if (token) return { token };

  // fallback to guest cart
  if (typeof window !== 'undefined') {
    const guestToken = localStorage.getItem(CART_TOKEN_KEY);
    if (guestToken) {
      return { headers: { 'x-cart-token': guestToken } };
    }
  }
  return {};
}

function rememberGuestToken(raw: BackendCart) {
  if (raw.guestCartToken && typeof window !== 'undefined') {
    localStorage.setItem(CART_TOKEN_KEY, raw.guestCartToken);
  }
}

/** Joins backend lines with catalog data. A SKU missing from the catalog keeps an empty product name. */
export function toCart(raw: BackendCart, catalog: ProductView[]): Cart {
  const bySku = new Map<string, { product: ProductView; sku: ProductView['skus'][number] }>();
  for (const product of catalog) {
    for (const sku of product.skus) bySku.set(sku.id, { product, sku });
  }

  const items: CartItem[] = raw.items.map((line) => {
    const found = bySku.get(line.skuId);
    const images = found?.product.media.filter((item) => item.type === 'image' && item.url) ?? [];
    const image = images.find((item) => item.isPrimary) ?? images[0] ?? null;
    return {
      skuId: line.skuId,
      quantity: line.quantity,
      canOrder: line.canOrder,
      priceAtAdd: line.priceAtAdd ?? null,
      priceChangedSinceAdd: !!line.priceChangedSinceAdd,
      sku: {
        id: line.skuId,
        code: found?.sku.code ?? '',
        variantName: found?.sku.variantName ?? '',
        size: found?.sku.size ?? null,
        sizeUnit: found?.sku.sizeUnit ?? null,
        product: {
          id: found?.product.id ?? '',
          name: found?.product.name ?? '',
          slug: found?.product.slug ?? '',
          brand: { name: found?.product.brand.name ?? '' },
          category: found?.product.category ? { slug: found.product.category.slug, name: found.product.category.name } : null,
        },
        image: image ? { url: image.url, alt: image.altText?.trim() || found?.product.name || '' } : null,
      },
      price:
        line.price === null
          ? null
          : { amount: line.price, currency: found?.sku.price?.currency ?? FALLBACK_CURRENCY },
      subtotal: line.lineTotal,
    };
  });

  return {
    sessionId: raw.id ?? '',
    revision: raw.revision,
    items,
    total: raw.totalAmount,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

/** GET /products is paginated (default 20, max 100), so a cart join must read every page. */
const CATALOG_PAGE_SIZE = 100;
const CATALOG_MAX_PAGES = 20;
const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache: { at: number; products: ProductView[] } | null = null;

async function loadCatalog(forceRefresh = false): Promise<ProductView[]> {
  if (!forceRefresh && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.products;
  const products: ProductView[] = [];
  for (let page = 1; page <= CATALOG_MAX_PAGES; page++) {
    const batch = await apiClient.get<ProductView[]>(`/products?page=${page}&limit=${CATALOG_PAGE_SIZE}`);
    products.push(...batch);
    if (batch.length < CATALOG_PAGE_SIZE) break;
  }
  catalogCache = { at: Date.now(), products };
  return products;
}

async function project(raw: BackendCart): Promise<Cart> {
  rememberGuestToken(raw);
  // Only hit the catalog when there is something to name.
  if (raw.items.length === 0) return toCart(raw, []);
  const cart = toCart(raw, await loadCatalog());
  // A line the cached catalog cannot name may be a newly published product: refresh once.
  if (cart.items.some((item) => !item.sku.product.name)) return toCart(raw, await loadCatalog(true));
  return cart;
}

export { project as projectCart };

/** Catalog display data for one SKU (orders draw thumbnails and sizes from it; the order keeps its own names). */
export interface SkuCatalogEntry {
  image: { url: string; alt: string } | null;
  size: number | null;
  sizeUnit: string | null;
  slug: string;
}

/** Catalog display data for the given SKUs, from the same cached catalog the cart uses. */
export async function catalogEntries(skuIds: string[]): Promise<Record<string, SkuCatalogEntry>> {
  if (!skuIds.length) return {};
  const wanted = new Set(skuIds);
  const entries: Record<string, SkuCatalogEntry> = {};
  for (const product of await loadCatalog()) {
    const images = product.media.filter((item) => item.type === 'image' && item.url);
    const image = images.find((item) => item.isPrimary) ?? images[0] ?? null;
    for (const sku of product.skus) {
      if (!wanted.has(sku.id)) continue;
      entries[sku.id] = {
        image: image ? { url: image.url, alt: image.altText?.trim() || product.name } : null,
        size: sku.size,
        sizeUnit: sku.sizeUnit,
        slug: product.slug,
      };
    }
  }
  return entries;
}

export const cart = {
  async getCart(): Promise<Cart> {
    return project(await apiClient.get<BackendCart>('/ordering/cart', getCartOptions()));
  },

  async addToCart(skuId: string, quantity: number = 1): Promise<Cart> {
    return project(await apiClient.post<BackendCart>('/ordering/cart/add', { skuId, quantity }, getCartOptions()));
  },

  async reorder(orderIdOrNumber: string, skuIds?: string[], guestOrderToken?: string): Promise<ReorderResult> {
    const guestAccessToken =
      guestOrderToken ??
      (typeof window !== 'undefined' ? localStorage.getItem('orderAccess:' + orderIdOrNumber) ?? undefined : undefined);

    const response = await apiClient.post<BackendReorderResult>(
      '/ordering/cart/reorder',
      { orderIdOrNumber, skuIds, orderAccessToken: guestAccessToken },
      getCartOptions(),
    );
    const projectedCart = await project(response.cart);
    return {
      cart: projectedCart,
      added: response.added,
      skipped: response.skipped,
      summary: response.summary,
    };
  },

  async updateQuantity(skuId: string, quantity: number): Promise<Cart> {
    return project(await apiClient.patch<BackendCart>('/ordering/cart/quantity', { skuId, quantity }, getCartOptions()));
  },

  async removeFromCart(skuId: string): Promise<Cart> {
    return project(await apiClient.post<BackendCart>('/ordering/cart/remove', { skuId }, getCartOptions()));
  },

  async clearCart(): Promise<void> {
    await apiClient.delete<void>('/ordering/cart', getCartOptions());
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CART_TOKEN_KEY);
    }
  },
};
