import { apiClient } from './api-client';
import { auth } from './auth';

export interface CareProfile {
  id: string;
  skinType?: string;
  sensitivities?: string;
  budget?: number;
  currency?: string;
  routineId?: string;
}

export const care = {
  async getProfile(): Promise<CareProfile> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    return apiClient.get<CareProfile>('/care/profiles', { token });
  },

  async updateProfile(data: Partial<CareProfile>): Promise<CareProfile> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    try {
      return await apiClient.patch<CareProfile>('/care/profiles', data, { token });
    } catch (e) {
      return await apiClient.post<CareProfile>('/care/profiles', { ...data, customerId: '' }, { token });
    }
  }
};
