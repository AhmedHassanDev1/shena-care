export const routes = {
  home: '/',
  products: '/products',
  cart: '/cart',
  checkout: '/checkout',
  account: '/account',
  accountAddresses: '/account/addresses',
  login: '/auth',
  register: '/auth',
  verify: '/auth/verify',
  routineBuilder: '/routine/builder',
  product: (slug: string) => `/products/${encodeURIComponent(slug)}`,
  /** Product page with a specific variant selected. */
  productVariant: (slug: string, skuId: string) => `/products/${encodeURIComponent(slug)}?sku=${encodeURIComponent(skuId)}`,
  myOrders: '/orders',
  order: (idOrNumber: string) => `/orders/${encodeURIComponent(idOrNumber)}`,
  /** Catalog listing narrowed by a category slug (GET /products?category=). */
  productsByCategory: (slug: string) => `/products?category=${encodeURIComponent(slug)}`,
  /** Ranked catalog search over products, brands, concerns and SKUs. */
  productsSearch: (query: string) => `/products?q=${encodeURIComponent(query)}`,
  /** Catalog listing narrowed by a curated care concern slug. */
  productsByConcern: (slug: string) => `/products?concern=${encodeURIComponent(slug)}`,
  routine: (id: string) => `/routines/${encodeURIComponent(id)}`,
} as const;

/** Category slugs of the two MVP entry points (seeded catalog roots: apps/api seed.ts). */
export const mainCategorySlugs = { skin: 'skin-care', hair: 'hair-care' } as const;
