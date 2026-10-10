import { Test, TestingModule } from '@nestjs/testing';
import { RoutineProposalService } from '../../src/modules/care/services/routine-proposal.service';
import { RecommendationValidatorService } from '../../src/modules/guidance/services/recommendation-validator.service';
import { RoutineWorkspaceService } from '../../src/modules/care/services/routine-workspace.service';
import { AiClient, AiClientError, AiErrorKind } from '../../src/platform/ai';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { RoutineProposalStatus } from '@prisma/client';

describe('GLO-117 AI Evaluation Harness', () => {
  let proposalService: RoutineProposalService;
  let mockAiClient: jest.Mocked<AiClient>;
  let mockValidator: jest.Mocked<RecommendationValidatorService>;
  let mockWorkspace: jest.Mocked<RoutineWorkspaceService>;
  let mockPrisma: any;

  beforeEach(async () => {
    mockAiClient = {
      recommendRoutine: jest.fn(),
      enrichProduct: jest.fn(),
      generateContent: jest.fn()
    } as any;

    mockValidator = {
      validateProposal: jest.fn()
    } as any;

    mockWorkspace = {
      getDraft: jest.fn()
    } as any;

    mockPrisma = {
      customerCareProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      routineProposal: {
        create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'prop-1', ...args.data }))
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutineProposalService,
        { provide: AiClient, useValue: mockAiClient },
        { provide: RecommendationValidatorService, useValue: mockValidator },
        { provide: RoutineWorkspaceService, useValue: mockWorkspace },
        { provide: PrismaService, useValue: mockPrisma }
      ]
    }).compile();

    proposalService = module.get<RoutineProposalService>(RoutineProposalService);
  });

  const setupDraft = (overrides = {}) => {
    mockWorkspace.getDraft.mockResolvedValue({
      id: 'draft-1',
      customerId: null,
      primaryConcern: 'dryness',
      secondaryGoals: [],
      budget: 100,
      isBudgetStrict: false,
      maxSteps: 3,
      ownedProductIds: [],
      ...overrides
    } as any);
  };

  it('1. Validates Skin and Hair routines structure', async () => {
    setupDraft({ careArea: 'skin' });
    mockAiClient.recommendRoutine.mockResolvedValue({
      schemaVersion: '1',
      message: 'Here is your routine',
      proposal: {
        title: 'Skin Routine',
        description: 'For dryness',
        careArea: 'skin',
        steps: [
          { title: 'Cleanser', productQuery: 'Gentle Cleanser', instructions: 'Wash' }
        ]
      }
    });
    mockValidator.validateProposal.mockResolvedValue({
      isValid: true, errors: [], stepResults: [
        {
          stepIndex: 0, stepTitle: 'Cleanser', isValid: true,
          productResolution: { resolved: true, productId: 'prod-1', skuId: 'sku-1' },
          availabilityCheck: { isSellable: true, skuId: 'sku-1', reason: '', terms: { price: { amount: 20 } } },
          errors: []
        }
      ]
    });

    const proposal = await proposalService.generateProposal('draft-1');
    expect(proposal.status).toBe(RoutineProposalStatus.proposed);
    expect(proposal.totalPrice).toBe(20);
    expect(proposal.snapshot.steps[0].resolvedProductId).toBe('prod-1');
  });

  it('2. Evaluates Tight budget constraints', async () => {
    setupDraft({ budget: 30, isBudgetStrict: true });
    mockAiClient.recommendRoutine.mockResolvedValue({
      proposal: { steps: [{ title: 'Expensive Cream' }] }
    } as any);
    mockValidator.validateProposal.mockResolvedValue({
      isValid: false,
      errors: ['Proposal total price (50) exceeds budget limit (30)'],
      stepResults: []
    });

    const proposal = await proposalService.generateProposal('draft-1');
    expect(proposal.status).toBe(RoutineProposalStatus.failed);
    expect(proposal.error.code).toBe('validation_failed');
  });

  it('3. Handles Already-owned products correctly without charging', async () => {
    setupDraft({ ownedProductIds: ['owned-prod-1'] });
    mockAiClient.recommendRoutine.mockResolvedValue({
      proposal: { steps: [{ title: 'Owned Serum' }] }
    } as any);
    mockValidator.validateProposal.mockResolvedValue({
      isValid: true, errors: [], stepResults: [{
        stepIndex: 0, stepTitle: 'Owned Serum', isValid: true,
        productResolution: { resolved: true, productId: 'owned-prod-1', skuId: 'sku-owned' },
        availabilityCheck: { isSellable: true, skuId: 'sku-owned', reason: '', terms: { price: { amount: 50 } } },
        errors: []
      }]
    });

    const proposal = await proposalService.generateProposal('draft-1');
    expect(proposal.status).toBe(RoutineProposalStatus.proposed);
    expect(proposal.totalPrice).toBe(0); // Price should be 0 since it is owned
    expect(proposal.snapshot.steps[0].isOwned).toBe(true);
  });

  it('4. Handles Unavailable SKU / Invalid product IDs gracefully', async () => {
    setupDraft();
    mockAiClient.recommendRoutine.mockResolvedValue({
      proposal: { steps: [{ title: 'Rare Item' }] }
    } as any);
    mockValidator.validateProposal.mockResolvedValue({
      isValid: false,
      errors: ['Product not sellable: Out of stock'],
      stepResults: [{
        stepIndex: 0, stepTitle: 'Rare Item', isValid: false,
        productResolution: { resolved: true, productId: 'prod-rare', skuId: 'sku-rare' },
        availabilityCheck: { isSellable: false, skuId: 'sku-rare', reason: 'Out of stock' },
        errors: ['Product not sellable: Out of stock']
      }]
    });

    const proposal = await proposalService.generateProposal('draft-1');
    expect(proposal.status).toBe(RoutineProposalStatus.failed);
  });

  it('5. Handles Malformed model output safely', async () => {
    setupDraft();
    // Simulate AI returning badly structured data that fails internal parsing or validation
    mockAiClient.recommendRoutine.mockRejectedValue(new Error('Malformed JSON'));

    const proposal = await proposalService.generateProposal('draft-1');
    expect(proposal.status).toBe(RoutineProposalStatus.failed);
    expect(proposal.error.code).toBe('internal_error');
    expect(proposal.snapshot).toEqual({});
  });

  it('6. Handles AI timeout / failure reliably', async () => {
    setupDraft();
    mockAiClient.recommendRoutine.mockRejectedValue(new AiClientError(AiErrorKind.TIMEOUT, 'AI timed out'));

    const proposal = await proposalService.generateProposal('draft-1');
    expect(proposal.status).toBe(RoutineProposalStatus.failed);
    expect(proposal.error.code).toBe(AiErrorKind.TIMEOUT);
    expect(proposal.error.retryable).toBe(true);
  });
});
