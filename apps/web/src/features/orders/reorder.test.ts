import { orders } from '@/lib/orders';
import { cart } from '@/lib/cart';
import { apiClient } from '@/lib/api-client';
import { auth } from '@/lib/auth';

jest.mock('@/lib/api-client');
jest.mock('@/lib/auth');

describe('Buy Again / Reorder Client Flow', () => {
  const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
  const mockedAuth = auth as jest.Mocked<typeof auth>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.getToken.mockReturnValue('mock-jwt-token');
  });

  it('calls cart reorder API and projects cart with items', async () => {
    const rawCart = {
      id: 'cart-1',
      ownerType: 'customer' as const,
      revision: 1,
      items: [
        {
          id: 'ci-1',
          skuId: 'sku-1',
          quantity: 2,
          price: 180,
          priceAtAdd: 180,
          priceChangedSinceAdd: false,
          canOrder: true,
          availability: 'available' as const,
          lineTotal: 360,
        },
      ],
      totalAmount: 360,
    };

    mockedApiClient.post.mockResolvedValueOnce({
      cart: rawCart,
      added: [
        {
          skuId: 'sku-1',
          productName: 'Cleanser',
          variantName: '200ml',
          requestedQuantity: 2,
          addedQuantity: 2,
          price: 180,
          status: 'added',
        },
      ],
      skipped: [],
      summary: { totalRequested: 1, totalAdded: 2, totalSkipped: 0 },
    });

    // Mock catalog call inside projectCart
    mockedApiClient.get.mockResolvedValueOnce([
      {
        id: 'prod-1',
        name: 'Cleanser',
        slug: 'cleanser',
        brand: { name: 'Brand A' },
        media: [],
        skus: [
          {
            id: 'sku-1',
            code: 'SKU1',
            variantName: '200ml',
            size: 200,
            sizeUnit: 'ml',
            price: { amount: 180, currency: 'EGP' },
          },
        ],
      },
    ]);

    const result = await cart.reorder('ORD-999');

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      '/ordering/cart/reorder',
      { orderIdOrNumber: 'ORD-999', skuIds: undefined, orderAccessToken: undefined },
      { token: 'mock-jwt-token' },
    );

    expect(result.summary.totalAdded).toBe(2);
    expect(result.summary.totalSkipped).toBe(0);
    expect(result.added[0].status).toBe('added');
    expect(result.cart.items).toHaveLength(1);
    expect(result.cart.items[0].skuId).toBe('sku-1');
    expect(result.cart.items[0].quantity).toBe(2);
  });

  it('orders.reorder delegates to cart.reorder and handles partial items', async () => {
    const rawCart = {
      id: 'cart-1',
      ownerType: 'customer' as const,
      revision: 1,
      items: [
        {
          id: 'ci-1',
          skuId: 'sku-1',
          quantity: 1,
          price: 100,
          priceAtAdd: 100,
          priceChangedSinceAdd: false,
          canOrder: true,
          availability: 'available' as const,
          lineTotal: 100,
        },
      ],
      totalAmount: 100,
    };

    mockedApiClient.post.mockResolvedValueOnce({
      cart: rawCart,
      added: [
        {
          skuId: 'sku-1',
          productName: 'Item 1',
          variantName: null,
          requestedQuantity: 1,
          addedQuantity: 1,
          price: 100,
          status: 'added',
        },
      ],
      skipped: [
        {
          skuId: 'sku-2',
          productName: 'Discontinued Item',
          variantName: null,
          requestedQuantity: 1,
          addedQuantity: 0,
          price: null,
          status: 'unavailable',
          reason: 'This item is currently unavailable or discontinued.',
        },
      ],
      summary: { totalRequested: 2, totalAdded: 1, totalSkipped: 1 },
    });

    mockedApiClient.get.mockResolvedValueOnce([]);

    const result = await orders.reorder('ORD-1234', ['sku-1', 'sku-2']);

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      '/ordering/cart/reorder',
      { orderIdOrNumber: 'ORD-1234', skuIds: ['sku-1', 'sku-2'], orderAccessToken: undefined },
      { token: 'mock-jwt-token' },
    );

    expect(result.summary.totalAdded).toBe(1);
    expect(result.summary.totalSkipped).toBe(1);
    expect(result.skipped[0].status).toBe('unavailable');
  });
});
