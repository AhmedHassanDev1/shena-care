export const routes = {
  home: '/',
  products: '/products',
  cart: '/cart',
  account: '/account',
  login: '/auth',
  register: '/auth',
  verify: '/auth/verify',
  routineBuilder: '/routine/builder',
  product: (slug: string) => `/products/${encodeURIComponent(slug)}`,
  /** Catalog listing narrowed by a category slug (GET /products?category=). */
  productsByCategory: (slug: string) => `/products?category=${encodeURIComponent(slug)}`,
  /** Catalog search over product, brand and SKU (GET /products?q=). */
  productsSearch: (query: string) => `/products?q=${encodeURIComponent(query)}`,
  /** Catalog listing narrowed by a care concern slug. The listing endpoint has no concern filter yet. */
  productsByConcern: (slug: string) => `/products?concern=${encodeURIComponent(slug)}`,
  routine: (id: string) => `/routines/${encodeURIComponent(id)}`,
} as const;

/** Category slugs of the two MVP entry points (seeded catalog roots: apps/api seed.ts). */
export const mainCategorySlugs = { skin: 'skin-care', hair: 'hair-care' } as const;
