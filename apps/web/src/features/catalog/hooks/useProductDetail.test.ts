import { useQuery } from '@tanstack/react-query';
import { getProductDetail, type ProductDetail } from '../api/discovery';
import { useProductDetail } from './useProductDetail';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn((options) => options),
}));

jest.mock('../api/discovery', () => ({
  getProductDetail: jest.fn(),
}));

describe('useProductDetail Data Architecture & Mock Prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries real product via getProductDetail with slug and no fake placeholder data', () => {
    useProductDetail('starville-whitening');

    expect(useQuery).toHaveBeenCalledTimes(1);
    const queryConfig = (useQuery as unknown as jest.Mock).mock.calls[0][0];

    expect(queryConfig.queryKey).toEqual(['product-detail', 'starville-whitening']);
    expect(queryConfig.placeholderData).toBeUndefined();
    expect(queryConfig.staleTime).toBe(60_000);
  });

  it('delegates directly to getProductDetail in queryFn', async () => {
    const mockDetail = {
      id: 'prod-1',
      name: 'Real Product',
      slug: 'real-product',
      skus: [],
      media: [],
    } as unknown as ProductDetail;

    (getProductDetail as jest.Mock).mockResolvedValueOnce(mockDetail);

    useProductDetail('real-product');
    const queryConfig = (useQuery as unknown as jest.Mock).mock.calls[0][0];

    const result = await queryConfig.queryFn();
    expect(getProductDetail).toHaveBeenCalledWith('real-product');
    expect(result).toEqual(mockDetail);
  });

  it('propagates API error in queryFn instead of catching and returning mock data', async () => {
    const error = new Error('Product not found (404)');
    (getProductDetail as jest.Mock).mockRejectedValueOnce(error);

    useProductDetail('non-existent');
    const queryConfig = (useQuery as unknown as jest.Mock).mock.calls[0][0];

    await expect(queryConfig.queryFn()).rejects.toThrow('Product not found (404)');
  });
});
