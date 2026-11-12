'use client';

import { useQuery } from '@tanstack/react-query';
import { auth } from '@/lib/auth';
import {
  getProductReviews,
  type ProductReviewPage,
  type ReviewSort,
} from '../api/discovery';

export interface UseProductReviewsOptions {
  page?: number;
  limit?: number;
  sort?: ReviewSort;
  rating?: number;
}

/**
 * Loads published product reviews and rating summary directly from the discovery API.
 * The backend enforces publication and moderation truth.
 * Does not fall back to mock or fake data.
 */
export function useProductReviews(
  slugOrId: string,
  options: UseProductReviewsOptions = {}
) {
  return useQuery<ProductReviewPage>({
    queryKey: [
      'product-reviews',
      slugOrId,
      options.page ?? 1,
      options.limit ?? 6,
      options.sort ?? 'recent',
      options.rating ?? 'all',
    ],
    queryFn: () => {
      const token = auth.getToken();
      return token
        ? getProductReviews(slugOrId, options, token)
        : getProductReviews(slugOrId, options);
    },
    staleTime: 60_000,
  });
}
