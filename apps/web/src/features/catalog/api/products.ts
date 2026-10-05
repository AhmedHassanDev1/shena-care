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

export async function getProducts(): Promise<ProductView[]> {
  return apiClient.get<ProductView[]>('/products');
}

export async function getProduct(slugOrId: string): Promise<ProductView> {
  return apiClient.get<ProductView>(`/products/${encodeURIComponent(slugOrId)}`);
}
