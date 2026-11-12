import { Test, TestingModule } from '@nestjs/testing';
import { GuidanceService } from '../../../src/modules/guidance/services/guidance.service';
import { PrismaService } from '../../../src/platform/database/prisma.service';
import { AiClient, AiClientError, AiErrorKind } from '../../../src/platform/ai';
import { RecommendationValidatorService } from '../../../src/modules/guidance/services/recommendation-validator.service';
import { ServiceUnavailableException, BadGatewayException, InternalServerErrorException } from '@nestjs/common';
import { GuidanceMessageRole } from '@prisma/client';

describe('GuidanceService Error Isolation', () => {
  let service: GuidanceService;
  let aiClient: jest.Mocked<AiClient>;
  let prisma: any;
  let validator: any;

  beforeEach(async () => {
    aiClient = {
      recommendRoutine: jest.fn(),
      enrichProduct: jest.fn(),
    } as any;

    prisma = {
      guidanceSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sess-1', customerId: 'cust-1', messages: [] }),
      },
      customerCareProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      routineDraft: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      guidanceMessage: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'msg-id', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    validator = {
      validateProposal: jest.fn().mockResolvedValue({ isValid: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuidanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiClient, useValue: aiClient },
        { provide: RecommendationValidatorService, useValue: validator },
      ],
    }).compile();

    service = module.get<GuidanceService>(GuidanceService);
  });

  it('should throw ServiceUnavailableException on AI timeout, exposing retry state', async () => {
    aiClient.recommendRoutine.mockRejectedValueOnce(
      new AiClientError(AiErrorKind.TIMEOUT, 'AI enrichment timed out')
    );

    await expect(service.sendMessage('sess-1', { content: 'hello' })).rejects.toThrow(
      ServiceUnavailableException
    );

    expect(prisma.guidanceMessage.create).toHaveBeenCalledTimes(1); // Only the user message was saved
    expect(prisma.guidanceMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: GuidanceMessageRole.user,
      }),
    }));
  });

  it('should throw BadGatewayException on malformed AI response', async () => {
    prisma.guidanceSession.findUnique.mockResolvedValueOnce({
      id: 'sess-1',
      customerId: 'cust-1',
      messages: [{ role: GuidanceMessageRole.user, content: 'test' }],
    });

    aiClient.recommendRoutine.mockRejectedValueOnce(
      new AiClientError(AiErrorKind.INCOMPATIBLE_SCHEMA, 'Schema error')
    );

    await expect(service.retryLastMessage('sess-1')).rejects.toThrow(
      BadGatewayException
    );
  });

  it('should not duplicate RoutineProposal on retry success', async () => {
    // Setup session with one user message
    prisma.guidanceSession.findUnique.mockResolvedValue({
      id: 'sess-1',
      customerId: 'cust-1',
      messages: [{ role: GuidanceMessageRole.user, content: 'help' }],
    });

    aiClient.recommendRoutine.mockResolvedValueOnce({
      schemaVersion: '1',
      message: 'Here is your routine',
      proposal: {
        steps: [],
        estimatedTotal: { amount: 0, currency: 'SAR' },
      }
    });

    const result = await service.retryLastMessage('sess-1');

    // Expected that only the assistant response is created (no new user message)
    expect(prisma.guidanceMessage.create).toHaveBeenCalledTimes(1);
    expect(result.role).toBe(GuidanceMessageRole.assistant);
  });

  it('passes published catalog product names to AiClient and returns validated resolvedProducts', async () => {
    validator.listCatalogProductNames = jest.fn().mockResolvedValue(['shaan Antioxidant Facial Cleanser']);
    validator.validateProposal.mockResolvedValue({
      isValid: true,
      errors: [],
      stepResults: [
        {
          stepIndex: 0,
          stepTitle: 'Cleanse',
          isValid: true,
          resolvedProduct: {
            productId: 'prod-1',
            slug: 'shaan-antioxidant-facial-cleanser',
            name: 'Antioxidant Facial Cleanser',
            brandName: 'shaan',
            categoryName: 'Cleansers',
            skuId: 'sku-1',
            variantName: '250 ml',
            price: { amount: 110, currency: 'EGP', compareAtAmount: null },
            isSellable: true,
          },
          errors: [],
        },
      ],
    });

    aiClient.recommendRoutine.mockResolvedValueOnce({
      schemaVersion: '1',
      type: 'proposal',
      message: 'إليك روتين تنظيف مناسب.',
      proposal: {
        title: 'روتين تنظيف',
        careArea: 'skin',
        steps: [{ title: 'Cleanse', timing: 'am', isOptional: false, productQuery: 'Antioxidant Facial Cleanser' }],
      },
    });

    const result: any = await service.sendMessage('sess-1', { content: 'عايزة غسول لطيف' });

    expect(aiClient.recommendRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ catalogProducts: ['shaan Antioxidant Facial Cleanser'] }),
      'sess-1',
    );
    expect(result.resolvedProducts).toHaveLength(1);
    expect(result.resolvedProducts[0]).toMatchObject({
      slug: 'shaan-antioxidant-facial-cleanser',
      skuId: 'sku-1',
      isSellable: true,
    });
  });
});
