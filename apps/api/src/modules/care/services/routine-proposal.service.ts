import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AiClient, AiClientError, AiErrorKind } from '../../../platform/ai';
import { RecommendationValidatorService } from '../../guidance/services/recommendation-validator.service';
import { RoutineWorkspaceService } from './routine-workspace.service';
import { RoutineProposalStatus, RoutineTiming, CareArea, Prisma } from '@prisma/client';

@Injectable()
export class RoutineProposalService {
  private readonly logger = new Logger(RoutineProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClient,
    private readonly validator: RecommendationValidatorService,
    private readonly workspace: RoutineWorkspaceService,
  ) {}

  async generateProposal(draftId: string, customerId?: string, guestToken?: string) {
    const draft = await this.workspace.getDraft(draftId, customerId, guestToken);

    // Build recommendation context
    let profileData: any = {};
    if (draft.customerId) {
      const profile = await this.prisma.customerCareProfile.findUnique({
        where: { customerId: draft.customerId },
        include: { concerns: { include: { concern: true } } }
      });
      if (profile) {
        profileData = {
          skinType: profile.skinType,
          sensitivities: profile.sensitivities,
          concerns: profile.concerns.map((c: any) => c.concern.name)
        };
      }
    }

    const input = {
      customerId: draft.customerId || `guest-${draft.id}`,
      profile: {
        skinType: profileData.skinType,
        sensitivities: profileData.sensitivities,
        concerns: [
          ...(profileData.concerns || []),
          draft.primaryConcern,
          ...(draft.secondaryGoals || [])
        ].filter(Boolean),
      },
      chatHistory: [], // No chat history in direct workspace flow for now
    };

    let result: any;
    let errorState: any = null;
    let rawProposal: any = null;

    try {
      // Bounded retry logic for safe operations could be added here, 
      // but for now relying on AI Client timeout and standard network retry
      result = await this.aiClient.recommendRoutine(input);
      rawProposal = result.proposal;
    } catch (err: any) {
      this.logger.error(`AI recommendation failed for draft ${draftId}`, err);
      
      // Handle AI timeouts, HTTP 429, 5xx, and malformed responses
      if (err instanceof AiClientError) {
        errorState = {
          code: err.kind,
          message: err.message,
          retryable: err.kind === AiErrorKind.TIMEOUT || err.kind === AiErrorKind.UNAVAILABLE
        };
      } else {
        errorState = {
          code: 'internal_error',
          message: 'An unexpected error occurred while generating the proposal',
          retryable: true
        };
      }
    }

    // Preserve Care Profile and RoutineDraft state when AI fails.
    // Never save a partially generated RoutineProposal.
    // Failed retries must not create duplicate records - we upsert or create a failed proposal.

    let snapshot = rawProposal;
    let totalPrice = 0;
    
    if (rawProposal) {
      // Deterministic Guidance validation
      const validationResult = await this.validator.validateProposal(rawProposal, { 
        budgetLimit: draft.isBudgetStrict ? Number(draft.budget) : undefined 
      });

      if (!validationResult.isValid) {
        errorState = {
          code: 'validation_failed',
          message: 'The AI generated a proposal that did not pass safety and availability validation.',
          details: validationResult.errors,
          retryable: true
        };
        snapshot = null; // Don't save invalid proposal as the valid snapshot
      } else {
        // Enforce deterministic rules:
        // Already-owned products are excluded from purchase totals.
        
        const validSteps = [];
        for (const stepResult of validationResult.stepResults) {
          const originalStep = rawProposal.steps[stepResult.stepIndex];
          if (stepResult.productResolution?.resolved && stepResult.availabilityCheck?.isSellable) {
             const productId = stepResult.productResolution.productId;
             const isOwned = draft.ownedProductIds.includes(productId as string);
             
             if (!isOwned && stepResult.availabilityCheck.terms?.price?.amount) {
               totalPrice += Number(stepResult.availabilityCheck.terms.price.amount);
             }
             
             validSteps.push({
               ...originalStep,
               resolvedProductId: productId,
               resolvedSkuId: stepResult.availabilityCheck.skuId,
               price: stepResult.availabilityCheck.terms?.price?.amount || 0,
               isOwned
             });
          } else {
            // Keep step but without resolved product
            validSteps.push(originalStep);
          }
        }
        snapshot.steps = validSteps;
      }
    }

    const proposal = await this.prisma.routineProposal.create({
      data: {
        draftId: draft.id,
        status: errorState ? RoutineProposalStatus.failed : RoutineProposalStatus.proposed,
        snapshot: snapshot || {},
        totalPrice: snapshot ? totalPrice : null,
        error: errorState || Prisma.DbNull,
      }
    });

    return proposal;
  }

  async acceptProposal(proposalId: string, customerId?: string, guestToken?: string) {
    const proposal = await this.prisma.routineProposal.findUnique({
      where: { id: proposalId },
      include: { draft: true }
    });

    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status !== RoutineProposalStatus.proposed) {
      throw new BadRequestException(`Cannot accept proposal with status ${proposal.status}`);
    }

    // Verify ownership
    if (proposal.draft.customerId && proposal.draft.customerId !== customerId) {
      throw new BadRequestException('Not authorized to accept this proposal');
    }

    const snapshot = proposal.snapshot as any;
    if (!snapshot || !snapshot.steps) {
      throw new BadRequestException('Proposal contains no valid snapshot to accept');
    }

    // Re-validate before acceptance
    const validationResult = await this.validator.validateProposal(snapshot);
    if (!validationResult.isValid) {
      throw new BadRequestException('Proposal is no longer valid: ' + validationResult.errors.join(', '));
    }

    // Explicit acceptance -> Saved Routine revision
    // Create new Routine and RoutineSteps
    return this.prisma.$transaction(async (tx: any) => {
      // Mark proposal accepted (idempotency)
      const updatedProposal = await tx.routineProposal.updateMany({
        where: { id: proposalId, status: RoutineProposalStatus.proposed },
        data: { status: RoutineProposalStatus.accepted }
      });

      if (updatedProposal.count === 0) {
         throw new BadRequestException('Proposal already accepted or invalid state');
      }

      const routine = await tx.routine.create({
        data: {
          title: snapshot.title || 'My Routine',
          description: snapshot.description,
          careArea: proposal.draft.careArea,
          isTemplate: false,
          isActive: true,
          steps: {
            create: snapshot.steps.map((step: any, idx: number) => ({
              title: step.title,
              instructions: step.instructions,
              stepOrder: idx,
              timing: step.timing || RoutineTiming.both,
              isOptional: step.isOptional || false,
              recommendations: step.resolvedProductId ? {
                create: [{ productId: step.resolvedProductId, source: 'ai' }]
              } : undefined
            }))
          }
        }
      });

      if (proposal.draft.customerId) {
        await tx.customerCareProfile.upsert({
          where: { customerId: proposal.draft.customerId },
          create: {
            customerId: proposal.draft.customerId,
            routineId: routine.id
          },
          update: {
            routineId: routine.id
          }
        });
      }

      return routine;
    });
  }
}
