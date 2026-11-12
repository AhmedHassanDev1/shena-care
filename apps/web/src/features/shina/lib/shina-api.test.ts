import { apiClient, ApiError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import {
  createGuidanceSession,
  getCustomerCareProfile,
  proposalToRoutinePreview,
  resolvedProductToShinaProduct,
  retryGuidanceMessage,
  sendGuidanceMessage,
} from './shina-api';

jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client');
  return {
    ...actual,
    apiClient: {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    },
  };
});

jest.mock('@/lib/auth', () => ({
  auth: {
    getToken: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedAuth = auth as jest.Mocked<typeof auth>;

describe('shina-api guidance integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws 401 UNAUTHENTICATED before calling backend when no token exists', async () => {
    mockedAuth.getToken.mockReturnValue(null);

    await expect(createGuidanceSession()).rejects.toMatchObject({
      status: 401,
      type: 'UNAUTHENTICATED',
    });
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });

  it('forwards token and AbortSignal to POST /guidance/sessions, /messages, and /retry', async () => {
    mockedAuth.getToken.mockReturnValue('tok-123');
    const controller = new AbortController();

    mockedApiClient.post
      .mockResolvedValueOnce({ id: 'sess-1', customerId: 'cust-1', status: 'active' } as never)
      .mockResolvedValueOnce({
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'جربي غسول لطيف',
      } as never)
      .mockResolvedValueOnce({
        id: 'msg-2',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'إعادة الرد',
      } as never);

    await createGuidanceSession(controller.signal);
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      '/guidance/sessions',
      {},
      { token: 'tok-123', signal: controller.signal },
    );

    await sendGuidanceMessage('sess-1', 'أفضل غسول', controller.signal);
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      '/guidance/sessions/sess-1/messages',
      { content: 'أفضل غسول' },
      { token: 'tok-123', signal: controller.signal },
    );

    await retryGuidanceMessage('sess-1', controller.signal);
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      3,
      '/guidance/sessions/sess-1/retry',
      {},
      { token: 'tok-123', signal: controller.signal },
    );
  });

  it('returns null gracefully when GET /care/profiles responds 404', async () => {
    mockedAuth.getToken.mockReturnValue('tok-123');
    mockedApiClient.get.mockRejectedValueOnce(new ApiError('Not found', 'NOT_FOUND', 404));

    await expect(getCustomerCareProfile()).resolves.toBeNull();
  });

  it('maps resolvedProducts and GuidanceProposal into verified Shina routine steps', () => {
    const resolved = [
      {
        productId: 'p1',
        skuId: 'sku-1',
        slug: 'cleanser-a',
        name: 'Antioxidant Facial Cleanser',
        brand: 'StarVille',
        price: 185,
        currency: 'EGP',
        variantName: '200 ml',
        category: 'Cleansers',
        imageUrl: 'https://cdn.example/1.jpg',
        canOrder: true,
      },
    ];

    expect(resolvedProductToShinaProduct(resolved[0])).toMatchObject({
      slug: 'cleanser-a',
      skuId: 'sku-1',
      price: 185,
      canOrder: true,
    });

    const preview = proposalToRoutinePreview(
      {
        name: 'Morning Care',
        careArea: 'skin',
        amSteps: [
          {
            order: 1,
            title: 'Cleanse',
            timing: 'am',
            recommendedProductName: 'Antioxidant Facial Cleanser',
            instructions: 'Gentle wash',
          },
        ],
        pmSteps: [],
      },
      resolved,
    );

    expect(preview?.steps).toHaveLength(1);
    expect(preview?.steps[0].product?.slug).toBe('cleanser-a');
  });
});
