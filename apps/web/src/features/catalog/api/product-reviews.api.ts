import { apiClient } from '@/lib/api-client';
import type { ProductReview, ProductReviewSummary } from './discovery';

export type ReviewEligibilityReason =
  | 'GUEST'
  | 'ELIGIBLE_PURCHASE'
  | 'ELIGIBLE_DEV_TEST'
  | 'ALREADY_REVIEWED'
  | 'NO_PURCHASE'
  | 'NOT_YET_DELIVERED'
  | 'CANCELLED_OR_REFUNDED'
  | 'ACCOUNT_INACTIVE';

export interface ProductReviewEligibility {
  authenticated: boolean;
  canReview: boolean;
  reason: ReviewEligibilityReason;
  isTestMode: boolean;
  existingReview: {
    id: string;
    rating: number;
    isVerifiedPurchase: boolean;
    isTest: boolean;
    createdAt: string;
  } | null;
}

export interface CreateProductReviewInput {
  rating: number;
  body?: string;
  skuId?: string;
}

export interface CreateProductReviewResponse {
  review: ProductReview;
  summary: ProductReviewSummary;
}

export async function getProductReviewEligibility(
  slugOrId: string,
  token?: string | null,
): Promise<ProductReviewEligibility> {
  return apiClient.get<ProductReviewEligibility>(
    `/products/${encodeURIComponent(slugOrId)}/reviews/eligibility`,
    token ? { token } : undefined,
  );
}

export async function submitProductReview(
  slugOrId: string,
  payload: CreateProductReviewInput,
  token: string,
): Promise<CreateProductReviewResponse> {
  return apiClient.post<CreateProductReviewResponse>(
    `/products/${encodeURIComponent(slugOrId)}/reviews`,
    payload,
    { token },
  );
}
