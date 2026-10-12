import { apiClient } from '@/lib/api-client';

export interface ProductView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  usage: string | null;
  warnings: string | null;
  brand: {
    id: string;
    name: string;
    slug: string;
  };
  skus: Array<{
    id: string;
    code: string;
    variantName: string;
    size: number | null;
    sizeUnit: string | null;
    price: {
      amount: number;
      currency: string;
      compareAtAmount: number | null;
    } | null;
    canOrder: boolean;
  }>;
  media: Array<{
    id: string;
    type: string;
    url: string;
    altText: string | null;
    isPrimary: boolean;
  }>;
}

/**
 * GET /products is paginated (default 20, backend maximum 100). Ask for the maximum so the listing is not
 * silently cut at 20; a catalog beyond 100 products needs real pagination in the UI.
 */
export const PRODUCT_PAGE_LIMIT = 100;

export async function getProducts(limit: number = PRODUCT_PAGE_LIMIT): Promise<ProductView[]> {
  return apiClient.get<ProductView[]>(`/products?limit=${limit}`);
}

export async function getProduct(slugOrId: string): Promise<ProductView> {
  return apiClient.get<ProductView>(`/products/${encodeURIComponent(slugOrId)}`);
}
