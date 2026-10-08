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

  async getOrder(idOrOrderNumber: string, passedGuestToken?: string): Promise<any> {
    const token = auth.getToken();
    const options: any = {};
    if (token) {
      options.token = token;
      return apiClient.get(`/ordering/orders/${idOrOrderNumber}/tracking`, options);
    } else {
      options.headers = { 'x-order-access-token': passedGuestToken };
      return apiClient.get(`/ordering/guest/orders/${idOrOrderNumber}/tracking`, options);
    }
  },

  async respondToAvailability(idOrOrderNumber: string, decisionId: string, action: string, version: number, passedGuestToken?: string): Promise<any> {
    const token = auth.getToken();
    const options: any = {};
    const payload = { action, expectedVersion: version };
    if (token) {
      options.token = token;
      return apiClient.post(`/ordering/availability-decisions/${decisionId}/decision`, payload, options);
    } else {
      options.headers = { 'x-order-access-token': passedGuestToken };
      return apiClient.post(`/ordering/guest/orders/${idOrOrderNumber}/availability-decisions/${decisionId}/decision`, payload, options);
    }
  }
};
