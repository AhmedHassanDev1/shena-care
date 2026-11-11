import { apiClient } from './api-client';
import { auth } from './auth';

export type SupportCaseCategory =
  | 'delivery'
  | 'return'
  | 'damaged_item'
  | 'wrong_item'
  | 'cancellation'
  | 'payment'
  | 'other';

export type SupportCaseStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface CustomerSupportCase {
  id: string;
  title: string;
  description: string;
  category: SupportCaseCategory | 'sourcing' | 'supplier_dispute' | 'safety_concern';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: SupportCaseStatus;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerSupportCaseInput {
  title: string;
  description: string;
  category?: SupportCaseCategory;
  orderId?: string;
}

export const SUPPORT_CASE_CATEGORIES: readonly SupportCaseCategory[] = [
  'delivery',
  'return',
  'damaged_item',
  'wrong_item',
  'cancellation',
  'payment',
  'other',
] as const;

export const MY_SUPPORT_CASES_QUERY_KEY = ['customer', 'support-cases'] as const;

export const supportApi = {
  /** Lists support requests owned by the signed-in customer. */
  async listMine(take = 10): Promise<CustomerSupportCase[]> {
    const token = auth.getToken();
    if (!token) return [];
    return apiClient.get<CustomerSupportCase[]>(`/operations/support/cases/mine?take=${take}`, { token });
  },

  /** Submits a new customer support request (optionally linked to one of the customer's own orders). */
  async create(input: CreateCustomerSupportCaseInput): Promise<CustomerSupportCase> {
    const token = auth.getToken();
    return apiClient.post<CustomerSupportCase>('/operations/support/cases', input, {
      token: token ?? undefined,
    });
  },
};
