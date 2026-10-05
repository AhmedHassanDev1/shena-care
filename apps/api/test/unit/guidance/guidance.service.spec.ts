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
});
