import { getProductDetail, type ProductDetail } from '@/features/catalog/api/discovery';
import type { ProductView } from '@/features/catalog/api/products';
import { sequenceRoutine } from '@/features/routine/lib/catalog-routine';
import {
  buildContextProductMessage,
  mapGuidanceDtoToMessage,
  runCatalogCompareWorkflow,
  runCatalogRoutineWorkflow,
  runCatalogSearchWorkflow,
} from './shina-workflows';

jest.mock('@/features/catalog/api/discovery', () => {
  const actual = jest.requireActual('@/features/catalog/api/discovery');
  return {
    ...actual,
    getProductDetail: jest.fn(),
  };
});

jest.mock('@/features/routine/lib/catalog-routine', () => {
  const actual = jest.requireActual('@/features/routine/lib/catalog-routine');
  return {
    ...actual,
    sequenceRoutine: jest.fn(),
  };
});

const mockedGetProductDetail = getProductDetail as jest.MockedFunction<typeof getProductDetail>;
const mockedSequenceRoutine = sequenceRoutine as jest.MockedFunction<typeof sequenceRoutine>;

const sampleProduct = (slug: string, name: string): ProductView => ({
  id: slug,
  slug,
  name,
  description: null,
  usage: null,
  warnings: null,
  brand: { id: 'b', name: 'StarVille', slug: 'starville' },
  category: { id: 'c', name: 'Cleansers', slug: 'cleansers', parentId: null },
  skus: [
    {
      id: `${slug}-sku`,
      code: slug,
      variantName: '200 ml',
      size: 200,
      sizeUnit: 'ml',
      price: { amount: 150, currency: 'EGP', compareAtAmount: null },
      canOrder: true,
    },
  ],
  media: [
    {
      id: 'm1',
      ...({ skuId: `${slug}-sku` } as any),
      type: 'image',
      url: `https://cdn.example/${slug}.jpg`,
      altText: null,
      isPrimary: true,
    },
  ],
});

const sampleDetail = (slug: string, name: string): ProductDetail => ({
  id: slug,
  slug,
  name,
  description: null,
  usage: 'Wash morning and night',
  warnings: 'External use only',
  brand: { id: 'b', name: 'StarVille', slug: 'starville' },
  productLine: null,
  category: { id: 'c', name: 'Cleansers', slug: 'cleansers', parentId: null },
  skus: [],
  media: [
    {
      id: 'm1',
      ...({ skuId: `${slug}-sku` } as any),
      type: 'image',
      url: `https://cdn.example/${slug}.jpg`,
      altText: null,
      sortOrder: 0,
      isPrimary: true,
      originType: 'catalog',
      role: null,
    },
  ],
  selectedSkuId: `${slug}-sku`,
  selectedVariant: {
    id: `${slug}-sku`,
    code: slug,
    barcode: null,
    variantName: '200 ml',
    size: 200,
    sizeUnit: 'ml',
    price: { amount: 150, currency: 'EGP', compareAtAmount: null },
    isAvailable: true,
    canOrder: true,
    availability: {
      isAvailable: true,
      isFresh: true,
      confirmedAt: null,
      observedAt: null,
      validUntil: null,
    },
    media: [],
    content: null,
    promotions: null,
  },
  evaluatedAt: '2026-11-11T00:00:00Z',
});

describe('shina workflows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds a real context lookup message when opened via ?product=', () => {
    const msg = buildContextProductMessage(sampleDetail('cleanser-1', 'Facial Cleanser'), 'ar');
    expect(msg.sourceKind).toBe('catalog-detail');
    expect(msg.products?.[0]).toMatchObject({ slug: 'cleanser-1', price: 150, canOrder: true });
    expect(msg.content).toContain('Wash morning and night');
  });

  it('returns an honest empty result state when catalog search has no matches', () => {
    const res = runCatalogSearchWorkflow('منتج غير موجود تماما', [sampleProduct('c1', 'Facial Cleanser')], 'ar', false);
    expect(res.state).toBe('completed');
    expect(res.message.products).toBeUndefined();
    expect(res.message.sourceKind).toBe('catalog-search');
  });

  it('executes dual getProductDetail calls for factual product comparisons', async () => {
    mockedGetProductDetail
      .mockResolvedValueOnce(sampleDetail('c1', 'Antioxidant Cleanser'))
      .mockResolvedValueOnce(sampleDetail('c2', 'Acne Cleanser'));

    const res = await runCatalogCompareWorkflow(
      'قارني بين غسولين',
      [sampleProduct('c1', 'Antioxidant Cleanser'), sampleProduct('c2', 'Acne Cleanser')],
      'ar',
      false,
    );

    expect(mockedGetProductDetail).toHaveBeenCalledTimes(2);
    expect(res.state).toBe('completed');
    expect(res.message.comparison?.products).toHaveLength(2);
  });

  it('runs real catalog routine sequencing without fabricating profiles', async () => {
    mockedSequenceRoutine.mockResolvedValueOnce({
      period: 'AM',
      steps: [{ position: 1, skuId: 'c1-sku', name: 'Antioxidant Cleanser', role: 'CLEANSER' }],
      excluded: [],
      notes: [],
      missing: ['SUNSCREEN'],
    });

    const res = await runCatalogRoutineWorkflow(
      'رتّبي لي روتين صباحي',
      [sampleProduct('c1', 'Antioxidant Cleanser')],
      'ar',
      false,
    );

    expect(mockedSequenceRoutine).toHaveBeenCalledWith(['c1-sku'], 'AM');
    expect(res.state).toBe('completed');
    expect(res.message.routine?.steps).toHaveLength(1);
  });

  it('maps clarification DTO to clarification activity state and verified products', () => {
    const res = mapGuidanceDtoToMessage(
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        type: 'clarification',
        content: 'هل بشرتك دهنية أم مختلطة؟',
        createdAt: '2026-11-11T00:00:00Z',
      },
      'ar',
      true,
    );
    expect(res.state).toBe('clarification');
    expect(res.message.sourceKind).toBe('ai-guidance');
  });

  it('shows the consultation payload: follow-up question, quick replies, escalation and sources', () => {
    const asked = mapGuidanceDtoToMessage({
      id: 'm2', sessionId: 's1', role: 'assistant', content: 'محتاجة أعرف حاجة واحدة.', createdAt: '2026-11-14T00:00:00Z',
      payload: {
        version: 1, source: 'AI', intent: 'recommend_products', language: 'ar', recommendations: [], routine: null, routineNote: null,
        citations: [], followUpQuestion: 'بشرتك نوعها إيه؟', quickReplies: ['دهنية', 'جافة'], escalation: null, excluded: [], understood: {},
      },
    }, 'ar', true);
    expect(asked.state).toBe('clarification');
    expect(asked.message.content).toContain('بشرتك نوعها إيه؟');
    expect(asked.message.suggestions).toEqual(['دهنية', 'جافة']);

    const escalated = mapGuidanceDtoToMessage({
      id: 'm3', sessionId: 's1', role: 'assistant', content: 'لازم دكتور يشوفها.', createdAt: '2026-11-14T00:00:00Z',
      payload: {
        version: 1, source: 'FALLBACK', intent: 'recommend_products', language: 'ar', recommendations: [], routine: null, routineNote: null,
        citations: [{ id: 'k1', topic: 'ESCALATION', subject: { type: 'CONCERN', key: 'acne' }, concernSlug: 'acne', statement: 'See a doctor if…',
          evidenceClass: 'EVIDENCE_SUPPORTED', professionallyReviewed: false,
          source: { title: 'NHS — Acne', url: 'https://www.nhs.uk/conditions/acne/', type: 'CLINICAL_GUIDELINE', retrievedAt: '2026-11-14T00:00:00Z' } }],
        followUpQuestion: null, quickReplies: [], escalation: { required: true, reasons: [{ code: 'INFECTION_SIGNS', text: 'فيه علامات عدوى.' }] },
        excluded: [], understood: {},
      },
    }, 'ar', true);
    expect(escalated.state).toBe('warning');
    expect(escalated.message.consult).toMatchObject({ fallback: true, escalation: ['فيه علامات عدوى.'], citations: [{ title: 'NHS — Acne', professionallyReviewed: false }] });
  });
});
