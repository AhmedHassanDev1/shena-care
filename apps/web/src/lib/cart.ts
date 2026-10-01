import { apiClient } from './api-client';
import { auth } from './auth';

export interface CartItem {
  skuId: string;
  quantity: number;
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
    };
  };
  price: {
    amount: number;
    currency: string;
  } | null;
  subtotal: number | null;
}

export interface Cart {
  sessionId: string;
  items: CartItem[];
  total: number;
  itemCount: number;
}

export const cart = {
  async getCart(): Promise<Cart> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    return apiClient.get<Cart>('/ordering/cart', token);
  },

  async addToCart(skuId: string, quantity: number = 1): Promise<Cart> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    return apiClient.post<Cart>('/ordering/cart/add', { skuId, quantity }, token);
  },

  async updateQuantity(skuId: string, quantity: number): Promise<Cart> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    return apiClient.patch<Cart>('/ordering/cart/quantity', { skuId, quantity }, token);
  },

  async removeFromCart(skuId: string): Promise<Cart> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    return apiClient.post<Cart>('/ordering/cart/remove', { skuId }, token);
  },

  async clearCart(): Promise<void> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    return apiClient.delete<void>('/ordering/cart', token);
  },
};
