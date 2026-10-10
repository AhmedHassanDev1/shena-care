import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CareArea, Prisma } from '@prisma/client';
import * as crypto from 'crypto';

export interface StartDraftDto {
  customerId?: string;
  careArea?: CareArea;
  primaryConcern?: string;
  secondaryGoals?: string[];
  budget?: number;
  isBudgetStrict?: boolean;
  maxSteps?: number;
}

export interface UpdateDraftDto {
  careArea?: CareArea;
  primaryConcern?: string;
  secondaryGoals?: string[];
  budget?: number;
  isBudgetStrict?: boolean;
  maxSteps?: number;
  ownedProductIds?: string[];
  preferences?: Record<string, any>;
  version: number;
}

@Injectable()
export class RoutineWorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async startDraft(dto: StartDraftDto, guestToken?: string) {
    let customerId = dto.customerId || null;
    let guestTokenHash = null;

    if (!customerId) {
      if (!guestToken) {
        guestToken = crypto.randomUUID();
      }
      guestTokenHash = this.hashToken(guestToken);
    } else {
      await this.prisma.routineDraft.deleteMany({
        where: { customerId }
      });
    }

    const draft = await this.prisma.routineDraft.create({
      data: {
        customerId,
        guestTokenHash,
        careArea: dto.careArea || CareArea.skin,
        primaryConcern: dto.primaryConcern,
        secondaryGoals: dto.secondaryGoals || [],
        budget: dto.budget,
        isBudgetStrict: dto.isBudgetStrict || false,
        maxSteps: dto.maxSteps,
      },
    });

    return { draft, guestToken };
  }

  async getDraft(draftId: string, customerId?: string, guestToken?: string) {
    const draft = await this.prisma.routineDraft.findUnique({
      where: { id: draftId },
      include: { proposals: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (!draft) throw new NotFoundException('Draft not found');

    this.verifyOwnership(draft, customerId, guestToken);

    return draft;
  }

  async updateDraft(draftId: string, dto: UpdateDraftDto, customerId?: string, guestToken?: string) {
    const draft = await this.getDraft(draftId, customerId, guestToken);

    if (draft.version !== dto.version) {
      throw new ConflictException('Draft has been updated by another request');
    }

    return this.prisma.routineDraft.update({
      where: { id: draftId, version: dto.version },
      data: {
        careArea: dto.careArea,
        primaryConcern: dto.primaryConcern,
        secondaryGoals: dto.secondaryGoals,
        budget: dto.budget,
        isBudgetStrict: dto.isBudgetStrict,
        maxSteps: dto.maxSteps,
        ownedProductIds: dto.ownedProductIds,
        preferences: dto.preferences as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
  }

  async linkGuestDraft(draftId: string, guestToken: string, customerId: string) {
    const guestTokenHash = this.hashToken(guestToken);
    const draft = await this.prisma.routineDraft.findUnique({
      where: { id: draftId },
    });

    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.guestTokenHash !== guestTokenHash) throw new ForbiddenException('Invalid guest token');

    // Remove any existing draft for this customer first to avoid unique constraint error
    await this.prisma.routineDraft.deleteMany({
      where: { customerId }
    });

    return this.prisma.routineDraft.update({
      where: { id: draftId },
      data: {
        customerId,
        guestTokenHash: null,
      },
    });
  }

  // Deterministic actions on latest proposal
  async modifyProposal(draftId: string, action: string, payload: any, customerId?: string, guestToken?: string) {
    const draft = await this.getDraft(draftId, customerId, guestToken);
    const latestProposal = draft.proposals[0];

    if (!latestProposal) throw new NotFoundException('No proposal to modify');

    let snapshot = latestProposal.snapshot as any;
    // Implement deterministic modifications to the snapshot
    // Add/replace product, Remove/restore step, Mark product already owned

    if (action === 'REPLACE_PRODUCT') {
      const { stepId, newProductId } = payload;
      // ... modify snapshot
      snapshot.steps = snapshot.steps.map((s: any) => 
        s.id === stepId ? { ...s, productId: newProductId } : s
      );
    } else if (action === 'REMOVE_STEP') {
      const { stepId } = payload;
      snapshot.steps = snapshot.steps.filter((s: any) => s.id !== stepId);
    } else if (action === 'MARK_OWNED') {
       // add to draft ownedProductIds
       await this.prisma.routineDraft.update({
         where: { id: draftId },
         data: {
           ownedProductIds: { push: payload.productId },
           version: { increment: 1 }
         }
       });
       // we should recalculate price
    }

    // Save modified snapshot
    return this.prisma.routineProposal.update({
      where: { id: latestProposal.id },
      data: { snapshot: snapshot as Prisma.InputJsonValue },
    });
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private verifyOwnership(draft: any, customerId?: string, guestToken?: string) {
    if (draft.customerId && draft.customerId !== customerId) {
      throw new ForbiddenException('Not authorized to access this draft');
    }
    if (draft.guestTokenHash && guestToken && this.hashToken(guestToken) !== draft.guestTokenHash) {
      throw new ForbiddenException('Invalid guest token');
    }
    if (!draft.customerId && !guestToken) {
      throw new ForbiddenException('Draft requires authentication or guest token');
    }
  }
}
