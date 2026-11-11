import fs from 'fs';
import path from 'path';
import { getProductReviewEligibility, submitProductReview } from '../api/product-reviews.api';
import { apiClient } from '@/lib/api-client';
import { messages } from '@/lib/i18n/messages';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe('Product Reviews API client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests review eligibility with optional bearer token', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      authenticated: false,
      canReview: false,
      reason: 'GUEST',
      isTestMode: false,
      existingReview: null,
    });

    await getProductReviewEligibility('eva-niacinamide');
    expect(apiClient.get).toHaveBeenCalledWith('/products/eva-niacinamide/reviews/eligibility', undefined);

    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      authenticated: true,
      canReview: true,
      reason: 'ELIGIBLE_PURCHASE',
      isTestMode: false,
      existingReview: null,
    });

    await getProductReviewEligibility('eva-niacinamide', 'tok-123');
    expect(apiClient.get).toHaveBeenCalledWith('/products/eva-niacinamide/reviews/eligibility', { token: 'tok-123' });
  });

  it('submits review rating (with optional body) and bearer token to server endpoint', async () => {
    (apiClient.post as jest.Mock).mockResolvedValueOnce({ review: { id: 'r1' }, summary: { count: 1 } });

    await submitProductReview('eva-niacinamide', { rating: 5, body: 'Great texture' }, 'tok-123');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/products/eva-niacinamide/reviews',
      { rating: 5, body: 'Great texture' },
      { token: 'tok-123' },
    );
  });
});

describe('PDP Product Reviews UI contracts', () => {
  const reviewsSrc = fs.readFileSync(path.resolve(__dirname, 'ProductReviews.tsx'), 'utf8');
  const composerSrc = fs.readFileSync(path.resolve(__dirname, 'ProductReviewComposer.tsx'), 'utf8');
  const devPanelSrc = fs.readFileSync(
    path.resolve(__dirname, '../../auth/components/DevEmailLoginPanel.tsx'),
    'utf8',
  );

  it('exposes Arabic CTA label أضف تقييمك in both bilingual dictionaries', () => {
    expect(messages.ar.pdpWriteReview).toBe('أضف تقييمك');
    expect(messages.en.pdpWriteReview).toBeTruthy();
  });

  it('opens existing AuthModal in-place for guests without redirecting away from PDP', () => {
    expect(reviewsSrc).toContain('openAuthModal({');
    expect(reviewsSrc).toContain("intent: 'review'");
    expect(reviewsSrc).not.toContain('router.push');
    expect(reviewsSrc).not.toContain('WriteReviewDialog');
  });

  it('keeps test reviews visually distinguished and handles optional body safely', () => {
    expect(reviewsSrc).toContain('currentReview.isTest');
    expect(reviewsSrc).toContain('m.pdpReviewTestBadge');
    expect(reviewsSrc).toContain('currentReview.body ? (');
    expect(reviewsSrc).toContain('hasSummaryReviews && summary ? (');
  });

  it('supports required 1-5 stars, optional written review, blocked reasons, and dev-mode banner', () => {
    expect(composerSrc).toContain('rating < 1 || rating > 5');
    expect(composerSrc).toContain('NOT_YET_DELIVERED');
    expect(composerSrc).toContain('CANCELLED_OR_REFUNDED');
    expect(composerSrc).toContain('NO_PURCHASE');
    expect(composerSrc).toContain('ALREADY_REVIEWED');
    expect(composerSrc).toContain('eligibility?.isTestMode');
  });

  it('gates DevEmailLoginPanel behind non-production, explicit flag, and localhost', () => {
    expect(devPanelSrc).toContain("process.env.NODE_ENV !== 'production'");
    expect(devPanelSrc).toContain("process.env.NEXT_PUBLIC_DEV_TEST_REVIEWS === 'true'");
    expect(devPanelSrc).toContain("'localhost'");
  });
});
