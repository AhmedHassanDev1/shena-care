import { useQuery } from '@tanstack/react-query';
import { discoverProducts, type DiscoveryPage } from '@/features/catalog/api/discovery';
import { useHomeProducts } from './useHomeProducts';

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn((options) => options) }));
jest.mock('@/features/catalog/api/discovery', () => ({ discoverProducts: jest.fn() }));

const query = () => {
  useHomeProducts();
  return (useQuery as jest.Mock).mock.calls[0][0] as {
    queryKey: string[];
    placeholderData?: DiscoveryPage;
    queryFn: () => Promise<DiscoveryPage>;
  };
};

describe('home discovery', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows an empty catalog as empty, without fallback products', async () => {
    const empty = { items: [], total: 0 } as unknown as DiscoveryPage;
    (discoverProducts as jest.Mock).mockResolvedValue(empty);

    const config = query();
    expect(config.queryKey).toEqual(['home', 'discovery']);
    expect(config.placeholderData).toBeUndefined();
    await expect(config.queryFn()).resolves.toBe(empty);
    expect(discoverProducts).toHaveBeenCalledWith({}, undefined, 8);
  });

  it('surfaces API failure so the existing retry UI can render', async () => {
    const failure = new Error('Discovery unavailable');
    (discoverProducts as jest.Mock).mockRejectedValue(failure);

    await expect(query().queryFn()).rejects.toBe(failure);
  });
});
