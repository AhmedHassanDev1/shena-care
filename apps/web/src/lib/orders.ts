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
  async checkout(data: CheckoutData): Promise<Order> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    return apiClient.post<Order>('/ordering/checkout', data, token);
  },

  async getOrder(idOrOrderNumber: string): Promise<Order> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    return apiClient.get<Order>(`/ordering/orders/${idOrOrderNumber}`, token);
  },
};
