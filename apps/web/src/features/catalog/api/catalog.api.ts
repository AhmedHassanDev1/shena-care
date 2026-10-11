import { ProductView } from '../types/catalog.types';
import { getProduct, getProducts } from './products';

/**
 * Client-side catalog queries go through the same API client as the server-rendered listing
 * (`lib/api-client`, base URL from NEXT_PUBLIC_API_URL). The previous axios client defaulted to
 * `localhost:3000/api` — the web app itself — so client-side product sections always failed locally.
 */
export const catalogApi = {
  getProducts: (): Promise<ProductView[]> => getProducts(),
  getProduct: (slugOrId: string): Promise<ProductView> => getProduct(slugOrId),
};
