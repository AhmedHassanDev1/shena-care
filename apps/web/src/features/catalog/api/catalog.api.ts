import { apiClient } from '@/lib/api/axios';
import { ProductView } from '../types/catalog.types';

export const catalogApi = {
  getProducts: async (): Promise<ProductView[]> => {
    const { data } = await apiClient.get<ProductView[]>('/products');
    return data;
  },

  getProduct: async (slugOrId: string): Promise<ProductView> => {
    const { data } = await apiClient.get<ProductView>(`/products/${encodeURIComponent(slugOrId)}`);
    return data;
  },
};
