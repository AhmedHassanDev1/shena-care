import { useQuery } from '@tanstack/react-query';
import { discoverProducts, type DiscoveryPage } from '@/features/catalog/api/discovery';
import { useHomeProducts } from './useHomeProducts';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn((options) => options),
}));

jest.mock('@/features/catalog/api/discovery', () => ({
  discoverProducts: jest.fn(),
}));

describe('useHomeProducts Data Architecture & Mock Prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries real products via discoverProducts with limit 8 and no placeholder fake data', () => {
    useHomeProducts();

    expect(useQuery).toHaveBeenCalledTimes(1);
    const queryConfig = (useQuery as unknown as jest.Mock).mock.calls[0][0];

    expect(queryConfig.queryKey).toEqual(['home', 'discovery']);
    expect(queryConfig.placeholderData).toBeUndefined();
    expect(queryConfig.staleTime).toBe(60_000);
  });

  it('delegates directly to discoverProducts in queryFn', async () => {
    const mockPage: DiscoveryPage = {
      items: [],
      total: 0,
      facets: { brands: [], categories: [], productLines: [] },
      pageInfo: {
        limit: 8,
        hasNextPage: false,
        nextCursor: null,
        snapshotAt: '2026-11-09T00:00:00.000Z',
        evaluatedAt: '2026-11-09T00:00:00.000Z',
      },
    };

    (discoverProducts as jest.Mock).mockResolvedValueOnce(mockPage);

    useHomeProducts();
    const queryConfig = (useQuery as unknown as jest.Mock).mock.calls[0][0];

    const result = await queryConfig.queryFn();
    expect(discoverProducts).toHaveBeenCalledWith({}, undefined, 8);
    expect(result).toEqual(mockPage);
    // Explicitly verifies empty catalog returns empty list, not fake products
    expect(result.items).toHaveLength(0);
  });

  it('propagates API errors without swallowing them or returning fake data', async () => {
    const error = new Error('Network error');
    (discoverProducts as jest.Mock).mockRejectedValueOnce(error);

    useHomeProducts();
    const queryConfig = (useQuery as unknown as jest.Mock).mock.calls[0][0];

    await expect(queryConfig.queryFn()).rejects.toThrow('Network error');
  });
});
