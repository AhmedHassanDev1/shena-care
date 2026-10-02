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
  async checkout(data: CheckoutData, isGuest?: boolean): Promise<Order & { guestToken?: string }> {
    const token = auth.getToken();
    if (!token && !isGuest) throw new Error('Not authenticated');
    return apiClient.post<Order & { guestToken?: string }>('/ordering/checkout', data, token || undefined);
  },

  async getOrder(idOrOrderNumber: string, guestToken?: string): Promise<Order> {
    const token = auth.getToken();
    
    // For guest access, we use the guestToken in query or custom header. 
    // Here we'll append it to the URL query string.
    const url = guestToken 
      ? `/ordering/orders/${idOrOrderNumber}?token=${encodeURIComponent(guestToken)}`
      : `/ordering/orders/${idOrOrderNumber}`;

    if (!token && !guestToken) {
      throw new Error('Not authenticated');
    }

    return apiClient.get<Order>(url, token || undefined);
  },
};
