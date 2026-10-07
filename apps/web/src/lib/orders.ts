import { apiClient } from './api-client';
import { auth } from './auth';

export interface CheckoutData {
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  idempotencyKey?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  paymentMethod: string;
  totalAmount: number;
  currency: string;
  items: Array<{
    skuId: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    sku: {
      variantName: string;
      product: {
        name: string;
      };
    };
  }>;
  createdAt: string;
}

export const orders = {
  async getQuote(data: { governorate: string; area: string; couponCode?: string }): Promise<any> {
    const token = auth.getToken();
    const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guestCartToken') : undefined;
    const options: any = {};
    if (token) options.token = token;
    else if (guestToken) options.headers = { 'x-cart-token': guestToken };
    
    return apiClient.post('/ordering/checkout/quote', data, options);
  },

  async checkout(data: any): Promise<Order & { guestToken?: string }> {
    const token = auth.getToken();
    const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guestCartToken') : undefined;
    const options: any = {};
    if (token) options.token = token;
    else if (guestToken) options.headers = { 'x-cart-token': guestToken };
    
    const response = await apiClient.post<Order & { guestToken?: string }>('/ordering/checkout', data, options);
    if (typeof window !== 'undefined' && guestToken) {
      localStorage.removeItem('guestCartToken'); // Order placed, cart consumed
    }
    return response;
  },

  async getOrder(idOrOrderNumber: string, passedGuestToken?: string): Promise<Order> {
    const token = auth.getToken();
    const url = passedGuestToken 
      ? `/ordering/orders/${idOrOrderNumber}?token=${encodeURIComponent(passedGuestToken)}`
      : `/ordering/orders/${idOrOrderNumber}`;

    const options: any = {};
    if (token) options.token = token;
    return apiClient.get<Order>(url, options);
  },
};
