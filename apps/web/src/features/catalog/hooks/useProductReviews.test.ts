import { useQuery } from '@tanstack/react-query';
import { getProductReviews, type ProductReviewPage } from '../api/discovery';
import { useProductReviews } from './useProductReviews';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn((options) => options),
}));

jest.mock('../api/discovery', () => ({
  getProductReviews: jest.fn(),
}));

describe('useProductReviews Data Architecture & Mock Prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries real reviews via getProductReviews with slug and no fake placeholder data', () => {
    useProductReviews('eva-niacinamide');

    expect(useQuery).toHaveBeenCalledTimes(1);
    const queryConfig = (useQuery as unknown as jest.Mock).mock.calls[0][0];

    expect(queryConfig.queryKey).toEqual([
      'product-reviews',
      'eva-niacinamide',
      1,
      6,
      'recent',
      'all',
    ]);
    expect(queryConfig.placeholderData).toBeUndefined();
    expect(queryConfig.staleTime).toBe(60_000);
  });

  it('delegates directly to getProductReviews in queryFn', async () => {
    const mockPage: ProductReviewPage = {
      summary: {
        average: 4.5,
        count: 10,
        distribution: { '1': 0, '2': 0, '3': 1, '4': 3, '5': 6 },
        recommendPercent: 90,
        verifiedCount: 8,
      },
      items: [],
      pageInfo: { page: 1, limit: 6, hasNextPage: false },
    };

    (getProductReviews as jest.Mock).mockResolvedValueOnce(mockPage);

    useProductReviews('eva-niacinamide', { rating: 5, sort: 'helpful' });
    const queryConfig = (useQuery as unknown as jest.Mock).mock.calls[0][0];

    const result = await queryConfig.queryFn();
    expect(getProductReviews).toHaveBeenCalledWith('eva-niacinamide', {
      rating: 5,
      sort: 'helpful',
    });
    expect(result).toEqual(mockPage);
  });

  it('propagates API error in queryFn instead of catching and returning mock data', async () => {
    const error = new Error('Network error');
    (getProductReviews as jest.Mock).mockRejectedValueOnce(error);

    useProductReviews('eva-niacinamide');
    const queryConfig = (useQuery as unknown as jest.Mock).mock.calls[0][0];

    await expect(queryConfig.queryFn()).rejects.toThrow('Network error');
  });
});
