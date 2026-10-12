import { apiClient, type RequestOptions } from './api-client';
import { auth } from './auth';

export interface CheckoutData {
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  governorate: string;
  area: string;
  idempotencyKey?: string;
  quoteVersion: string;
  cartRevision: number;
}

/**
 * Checkout quote exactly as `POST /ordering/checkout/quote` returns it
 * (apps/api ordering.service.ts: `{ quoteVersion, expiresAt, revision, ...QuoteSnapshot, invalidItems }`).
 * Amounts are numbers in `currency`; `quoteVersion` must be echoed back on checkout.
 */
export interface CheckoutQuote {
  quoteVersion: string;
  expiresAt: string;
  revision: number;
  governorate: string;
  area: string;
  cartRevision: number;
  subtotal: number;
  shippingFee: number;
  codAmount: number;
  totalAmount: number;
  currency: string;
  deliveryPromise: string;
  availabilityCertainty: string;
  items: Array<{
    skuId: string;
    productName: string;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    currency: string;
  }>;
  /** Lines the backend cannot sell right now. */
  invalidItems: unknown[];
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
  async getQuote(data: { governorate: string; area: string; couponCode?: string }): Promise<CheckoutQuote> {
    const token = auth.getToken();
    const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guestCartToken') : undefined;
    const options: RequestOptions = {};
    if (token) options.token = token;
    else if (guestToken) options.headers = { 'x-cart-token': guestToken };
    
    return apiClient.post<CheckoutQuote>('/ordering/checkout/quote', data, options);
  },

  async checkout(data: CheckoutData): Promise<Order & { guestToken?: string }> {
    const token = auth.getToken();
    const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guestCartToken') : undefined;
    const options: RequestOptions = {};
    if (token) options.token = token;
    else if (guestToken) options.headers = { 'x-cart-token': guestToken };
    
    const response = await apiClient.post<Order & { guestToken?: string }>('/ordering/checkout', data, options);
    if (typeof window !== 'undefined' && guestToken) {
      localStorage.removeItem('guestCartToken'); // Order placed, cart consumed
    }
    return response;
  },

  async getOrder(idOrOrderNumber: string, passedGuestToken?: string): Promise<unknown> {
    const token = auth.getToken();
    const options: RequestOptions = {};
    if (token) {
      options.token = token;
      return apiClient.get<unknown>(`/ordering/orders/${idOrOrderNumber}/tracking`, options);
    } else {
      if (passedGuestToken) options.headers = { 'x-order-access-token': passedGuestToken };
      return apiClient.get<unknown>(`/ordering/guest/orders/${idOrOrderNumber}/tracking`, options);
    }
  },

  async respondToAvailability(idOrOrderNumber: string, decisionId: string, action: string, version: number, passedGuestToken?: string): Promise<unknown> {
    const token = auth.getToken();
    const options: RequestOptions = {};
    const payload = { action, expectedVersion: version };
    if (token) {
      options.token = token;
      return apiClient.post<unknown>(`/ordering/availability-decisions/${decisionId}/decision`, payload, options);
    } else {
      if (passedGuestToken) options.headers = { 'x-order-access-token': passedGuestToken };
      return apiClient.post<unknown>(`/ordering/guest/orders/${idOrOrderNumber}/availability-decisions/${decisionId}/decision`, payload, options);
    }
  }
};
