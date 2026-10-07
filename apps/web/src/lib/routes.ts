export const routes = {
  home: '/',
  products: '/products',
  cart: '/cart',
  login: '/auth',
  register: '/auth',
  verify: '/auth/verify',
  routineBuilder: '/routine/builder',
  product: (slug: string) => `/products/${encodeURIComponent(slug)}`,
} as const;
