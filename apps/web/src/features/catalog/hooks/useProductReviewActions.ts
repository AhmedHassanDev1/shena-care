'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auth } from '@/lib/auth';
import {
  getProductReviewEligibility,
  submitProductReview,
  type CreateProductReviewInput,
  type CreateProductReviewResponse,
  type ProductReviewEligibility,
} from '../api/product-reviews.api';

export function reviewEligibilityQueryKey(slug: string, userId?: string | null) {
  return ['product-review-eligibility', slug, userId ?? 'guest'] as const;
}

export function useReviewEligibility(slug: string, enabled: boolean, userId?: string | null) {
  return useQuery<ProductReviewEligibility>({
    queryKey: reviewEligibilityQueryKey(slug, userId),
    queryFn: () => getProductReviewEligibility(slug, auth.getToken()),
    enabled: Boolean(slug) && enabled,
    staleTime: 15_000,
  });
}

export function useSubmitProductReview(slug: string) {
  const queryClient = useQueryClient();

  return useMutation<CreateProductReviewResponse, Error, CreateProductReviewInput>({
    mutationFn: async (payload) => {
      const token = auth.getToken();
      if (!token) {
        throw new Error('AUTH_REQUIRED');
      }
      return submitProductReview(slug, payload, token);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['product-reviews', slug] }),
        queryClient.invalidateQueries({ queryKey: ['product-review-eligibility', slug] }),
      ]);
    },
  });
}
