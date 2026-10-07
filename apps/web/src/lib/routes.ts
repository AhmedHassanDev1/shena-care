export const routes = {
  home: '/',
  products: '/products',
  cart: '/cart',
  login: '/auth/login',
  register: '/auth/register',
  routineBuilder: '/routine/builder',
  product: (slug: string) => `/products/${encodeURIComponent(slug)}`,
} as const;
