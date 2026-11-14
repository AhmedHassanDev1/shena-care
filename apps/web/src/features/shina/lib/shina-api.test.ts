import { apiClient, ApiError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import {
  createGuidanceSession,
  getCustomerCareProfile,
  consultRoutineToPreview,
  recommendedToShinaProduct,
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

  it('sends the page context when a consultation starts from a concern', async () => {
    mockedAuth.getToken.mockReturnValue('tok-123');
    mockedApiClient.post.mockResolvedValueOnce({ id: 'sess-2', status: 'active' } as never);
    await createGuidanceSession(undefined, { kind: 'corner', concernSlug: 'acne' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('/guidance/sessions', { page: { kind: 'corner', concernSlug: 'acne' } }, { token: 'tok-123', signal: undefined });
  });

  it('maps an engine-picked routine into chat steps with the reason, and offers saving only when allowed', () => {
    const item = {
      productId: 'p1', skuId: 'sku-1', slug: 'cleanser-a', name: 'Antioxidant Facial Cleanser', brand: 'StarVille', brandSlug: 'starville',
      productType: 'cleanser', role: 'CLEANSER', careArea: 'skin' as const, variantName: '200 ml', sizeLabel: '200 ml', size: 200, sizeUnit: 'ml',
      imageUrl: 'https://cdn.example/1.jpg', category: { slug: 'cleansers', name: 'Cleansers' },
      price: { amount: 185, currency: 'EGP', compareAtAmount: null }, canOrder: true as const, matchLevel: 'GOOD' as const,
      reasons: [{ code: 'TYPE_FOR_CONCERN', basis: 'EVIDENCE' as const, text: 'Gentle cleansing helps acne-prone skin.' }],
      cautions: [], unknowns: [], keyActives: [], usage: { text: 'Massage onto wet skin, rinse.', period: null, verified: false },
    };
    expect(recommendedToShinaProduct(item, 'Why it fits')).toMatchObject({ slug: 'cleanser-a', skuId: 'sku-1', price: 185, canOrder: true, rationale: 'Why it fits' });
    expect(recommendedToShinaProduct(item).rationale).toBe('Gentle cleansing helps acne-prone skin.');

    const labels = { AM: 'Morning', PM: 'Evening', AS_NEEDED: 'As needed' };
    const routine = {
      title: 'Acne care', careArea: 'skin' as const, canSave: true,
      steps: [{ slot: 'AM' as const, why: 'Start clean', howToUse: 'Massage onto wet skin, rinse.', item }, { slot: 'PM' as const, why: 'End clean', howToUse: null, item }],
      issues: [
        { code: 'INGREDIENTS_UNVERIFIED', severity: 'INFO' as const, textAr: 'غير موثّق', textEn: 'Not verified', skuIds: ['sku-1'] },
        { code: 'DUPLICATE_ROLE', severity: 'INFO' as const, textAr: 'تكرار', textEn: 'Duplicate', skuIds: ['sku-1'] },
      ],
    };
    const preview = consultRoutineToPreview(routine, 'en', labels);
    expect(preview?.steps.map((step) => [step.timing, step.roleLabel, step.instructions])).toEqual([['am', 'Morning', 'Start clean'], ['pm', 'Evening', 'End clean']]);
    expect(preview?.notes).toEqual(['Not verified']); // only the INFO issue that matters to the customer
    expect(preview?.save?.steps).toEqual([
      { title: 'Antioxidant Facial Cleanser', timing: 'AM', skuId: 'sku-1', reason: 'Start clean' },
      { title: 'Antioxidant Facial Cleanser', timing: 'PM', skuId: 'sku-1', reason: 'End clean' },
    ]);
    expect(consultRoutineToPreview({ ...routine, canSave: false }, 'en', labels)?.save).toBeUndefined();
    expect(consultRoutineToPreview(null, 'en', labels)).toBeUndefined();
  });
});
