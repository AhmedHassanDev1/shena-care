import { apiClient } from './api-client';
import { auth } from './auth';

export interface CustomerAddress {
  id: string;
  customerId: string;
  label: string | null;
  customerName: string;
  customerPhone: string;
  governorate: string;
  area: string;
  shippingAddress: string;
  notes: string | null;
  latitude: number;
  longitude: number;
  locationSource: 'map_pin' | 'current_location';
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerAddressInput {
  label?: string;
  customerName: string;
  customerPhone: string;
  governorate: string;
  area: string;
  shippingAddress: string;
  notes?: string;
  latitude: number;
  longitude: number;
  locationSource?: 'map_pin' | 'current_location';
  isDefault?: boolean;
}

export interface UpdateCustomerAddressInput {
  label?: string;
  customerName?: string;
  customerPhone?: string;
  governorate?: string;
  area?: string;
  shippingAddress?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  locationSource?: 'map_pin' | 'current_location';
  isDefault?: boolean;
}

function authOptions() {
  const token = auth.getToken();
  if (!token) throw new Error('Customer is not authenticated');
  return { token };
}

export const addressesApi = {
  async list(): Promise<CustomerAddress[]> {
    const token = auth.getToken();
    if (!token) return [];
    return apiClient.get<CustomerAddress[]>('/accounts/addresses', { token });
  },

  async get(id: string): Promise<CustomerAddress> {
    return apiClient.get<CustomerAddress>(`/accounts/addresses/${encodeURIComponent(id)}`, authOptions());
  },

  async create(data: CreateCustomerAddressInput): Promise<CustomerAddress> {
    return apiClient.post<CustomerAddress>('/accounts/addresses', data, authOptions());
  },

  async update(id: string, data: UpdateCustomerAddressInput): Promise<CustomerAddress> {
    return apiClient.patch<CustomerAddress>(`/accounts/addresses/${encodeURIComponent(id)}`, data, authOptions());
  },

  async delete(id: string): Promise<{ success: boolean }> {
    return apiClient.delete<{ success: boolean }>(`/accounts/addresses/${encodeURIComponent(id)}`, authOptions());
  },

  async setDefault(id: string): Promise<CustomerAddress> {
    return apiClient.post<CustomerAddress>(`/accounts/addresses/${encodeURIComponent(id)}/default`, {}, authOptions());
  },
};
