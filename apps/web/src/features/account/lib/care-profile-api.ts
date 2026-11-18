import { apiClient } from '@/lib/api-client';
import { auth } from '@/lib/auth';

export type SkinType = 'normal' | 'dry' | 'oily' | 'combination' | 'sensitive';
export type HairType = 'straight' | 'wavy' | 'curly' | 'coily';
export type ScalpType = 'normal' | 'dry' | 'oily' | 'sensitive';
export type CareFocus = 'skin' | 'hair' | 'both';
export type SunExposure = 'low' | 'moderate' | 'high';
export type PreferredTexture = 'gel' | 'cream' | 'lotion' | 'fluid' | 'rich_cream';

export interface ConcernItem {
  id: string;
  name: string;
  slug: string;
  careArea: 'skin' | 'hair' | 'body' | string;
  description?: string | null;
  isActive?: boolean;
}

export interface ProfileConcernRelation {
  id: string;
  concernId: string;
  severity: number;
  concern: ConcernItem;
}

export interface CustomerCareProfile {
  id: string;
  customerId: string;
  skinType: SkinType | null;
  hairType: HairType | null;
  scalpType: ScalpType | null;
  primaryFocus: CareFocus | null;
  sunExposure: SunExposure | null;
  preferredTexture: PreferredTexture | null;
  ageBand: string | null;
  experienceLevel: string | null;
  fragranceFree: boolean | null;
  sensitivities: string | null;
  budget: number | null;
  currency: string | null;
  concerns: ProfileConcernRelation[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCareProfileInput {
  skinType?: SkinType | null;
  hairType?: HairType | null;
  scalpType?: ScalpType | null;
  primaryFocus?: CareFocus | null;
  sunExposure?: SunExposure | null;
  preferredTexture?: PreferredTexture | null;
  fragranceFree?: boolean | null;
  sensitivities?: string | null;
  budget?: number | null;
  concerns?: Array<{ concernId: string; severity?: number }>;
}

export const careProfileApi = {
  async getProfile(): Promise<CustomerCareProfile | null> {
    const token = auth.getToken();
    if (!token) return null;
    try {
      return await apiClient.get<CustomerCareProfile>('/care/profiles', { token });
    } catch {
      return null;
    }
  },

  async updateProfile(data: UpdateCareProfileInput): Promise<CustomerCareProfile> {
    const token = auth.getToken();
    if (!token) throw new Error('Not authenticated');
    return apiClient.patch<CustomerCareProfile>('/care/profiles', data, { token });
  },

  async getPublicConcerns(): Promise<ConcernItem[]> {
    try {
      return await apiClient.get<ConcernItem[]>('/care/concerns');
    } catch {
      return [];
    }
  },
};
