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

const CART_TOKEN_KEY = 'guestCartToken';

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

function handleCartResponse(cartData: any) {
  if (cartData.guestCartToken && typeof window !== 'undefined') {
    localStorage.setItem(CART_TOKEN_KEY, cartData.guestCartToken);
  }
  return cartData;
}

export const cart = {
  async getCart(): Promise<Cart> {
    const response = await apiClient.get<Cart>('/ordering/cart', getCartOptions());
    return handleCartResponse(response);
  },

  async addToCart(skuId: string, quantity: number = 1): Promise<Cart> {
    const response = await apiClient.post<Cart>('/ordering/cart/add', { skuId, quantity }, getCartOptions());
    return handleCartResponse(response);
  },

  async updateQuantity(skuId: string, quantity: number): Promise<Cart> {
    const response = await apiClient.patch<Cart>('/ordering/cart/quantity', { skuId, quantity }, getCartOptions());
    return handleCartResponse(response);
  },

  async removeFromCart(skuId: string): Promise<Cart> {
    const response = await apiClient.post<Cart>('/ordering/cart/remove', { skuId }, getCartOptions());
    return handleCartResponse(response);
  },

  async clearCart(): Promise<void> {
    await apiClient.delete<void>('/ordering/cart', getCartOptions());
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CART_TOKEN_KEY);
    }
  },
};
