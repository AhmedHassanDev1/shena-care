import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CareArea, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { ProposalActionDto, StartRoutineDraftDto, UpdateRoutineDraftDto } from '../dto/routine-workspace.dto';
import { readOverrides, readSafety } from './routine-engine.service';

export interface DraftOwner {
  customerId?: string;
  guestToken?: string;
}

/** Fields of the draft a client may see: never the guest token hash. */
const PUBLIC_DRAFT_SELECT = {
  id: true, customerId: true, careArea: true, primaryConcern: true, secondaryGoals: true, budget: true, isBudgetStrict: true,
  maxSteps: true, severity: true, skinType: true, tier: true, ageBand: true, experienceLevel: true, fragranceFree: true,
  safety: true, allergyIngredientIds: true, ownedRoleKeys: true, overrides: true, consentVersion: true, consentAt: true,
  version: true, createdAt: true, updatedAt: true,
} satisfies Prisma.RoutineDraftSelect;

@Injectable()
export class RoutineWorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async startDraft(dto: StartRoutineDraftDto, owner: DraftOwner) {
    let guestToken: string | undefined;
    let guestTokenHash: string | null = null;
    if (!owner.customerId) {
      guestToken = owner.guestToken ?? crypto.randomUUID();
      guestTokenHash = this.hashToken(guestToken);
    }
    const draft = await this.prisma.routineDraft.create({
      data: {
        customerId: owner.customerId ?? null,
        guestTokenHash,
        careArea: dto.careArea ?? CareArea.skin,
        primaryConcern: dto.primaryConcern,
        secondaryGoals: dto.secondaryGoals ?? [],
        severity: dto.severity,
        skinType: dto.skinType,
        budget: dto.budget,
        tier: dto.tier,
        ageBand: dto.ageBand,
        experienceLevel: dto.experienceLevel,
        fragranceFree: dto.fragranceFree,
      },
      select: PUBLIC_DRAFT_SELECT,
    });
    return { draft, guestToken };
  }

  /** The full row, for services only (includes the guest token hash for ownership checks). */
  async loadOwnedDraft(draftId: string, owner: DraftOwner) {
    const draft = await this.prisma.routineDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException('Draft not found');
    this.verifyOwnership(draft, owner);
    return draft;
  }

  async getDraft(draftId: string, owner: DraftOwner) {
    await this.loadOwnedDraft(draftId, owner);
    const draft = await this.prisma.routineDraft.findUniqueOrThrow({ where: { id: draftId }, select: PUBLIC_DRAFT_SELECT });
    const latest = await this.prisma.routineProposal.findFirst({ where: { draftId }, orderBy: { createdAt: 'desc' } });
    return { ...draft, latestProposal: latest };
  }

  async updateDraft(draftId: string, dto: UpdateRoutineDraftDto, owner: DraftOwner) {
    const current = await this.loadOwnedDraft(draftId, owner);
    const underFifteen = (dto.ageBand ?? current.ageBand) === 'UNDER_15';

    const data: Prisma.RoutineDraftUpdateManyMutationInput = {
      careArea: dto.careArea, primaryConcern: dto.primaryConcern, secondaryGoals: dto.secondaryGoals, severity: dto.severity,
      skinType: dto.skinType, budget: dto.budget, tier: dto.tier, ageBand: dto.ageBand, experienceLevel: dto.experienceLevel,
      fragranceFree: dto.fragranceFree, ownedRoleKeys: dto.ownedRoleKeys, version: { increment: 1 },
    };

    if (underFifteen) {
      // No health data is kept for under-15s without a guardian (§8-ج, §10-أ).
      Object.assign(data, { safety: Prisma.DbNull, allergyIngredientIds: [], consentVersion: null, consentAt: null });
    } else if (dto.safety || dto.allergyIngredientIds) {
      const consentVersion = dto.consentVersion ?? current.consentVersion;
      if (!consentVersion) {
        throw new BadRequestException({ code: 'CONSENT_REQUIRED', message: 'Health answers need consent to the privacy notice first.' });
      }
      const safety = { ...readSafety(current.safety), ...(dto.safety ?? {}) };
      Object.assign(data, {
        safety: safety as unknown as Prisma.InputJsonValue,
        allergyIngredientIds: dto.allergyIngredientIds ?? current.allergyIngredientIds,
        consentVersion,
        consentAt: dto.consentVersion ? new Date() : current.consentAt,
      });
    }

    await this.casUpdate(draftId, dto.version, data);
    return this.getDraft(draftId, owner);
  }

  /** Applies one proposal edit to the draft; the caller regenerates the proposal from it. */
  async applyAction(draftId: string, dto: ProposalActionDto, owner: DraftOwner) {
    const current = await this.loadOwnedDraft(draftId, owner);
    const overrides = readOverrides(current.overrides);
    const owned = new Set(current.ownedRoleKeys);
    const data: Prisma.RoutineDraftUpdateManyMutationInput = { version: { increment: 1 } };
    const role = () => {
      if (!dto.roleKey) throw new BadRequestException(`${dto.action} needs roleKey`);
      return dto.roleKey;
    };

    switch (dto.action) {
      case 'SWAP_ITEM':
        if (!dto.productId) throw new BadRequestException('SWAP_ITEM needs productId');
        overrides.swaps[role()] = dto.productId;
        break;
      case 'SET_OWNED':
        if (dto.owned === false) owned.delete(role()); else owned.add(role());
        data.ownedRoleKeys = [...owned].sort();
        break;
      case 'REMOVE_OPTIONAL':
        overrides.removed = [...new Set([...overrides.removed, role()])].sort();
        break;
      case 'RESTORE_OPTIONAL':
        overrides.removed = overrides.removed.filter(r => r !== role());
        break;
      case 'ACCEPT_UPGRADE':
        overrides.upgrades = [...new Set([...overrides.upgrades, role()])].sort();
        break;
      case 'SET_TIER':
        if (!dto.tier) throw new BadRequestException('SET_TIER needs tier');
        data.tier = dto.tier;
        // A new tier means a fresh pick: swaps and consented upgrades were for the old one.
        overrides.swaps = {};
        overrides.upgrades = [];
        break;
      case 'SET_BUDGET':
        if (dto.budget === undefined) throw new BadRequestException('SET_BUDGET needs budget');
        data.budget = dto.budget;
        break;
    }
    data.overrides = overrides as unknown as Prisma.InputJsonValue;
    await this.casUpdate(draftId, dto.version, data);
  }

  async linkGuestDraft(draftId: string, guestToken: string, customerId: string) {
    const draft = await this.prisma.routineDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.customerId === customerId) return this.getDraft(draftId, { customerId });
    if (!guestToken || draft.guestTokenHash !== this.hashToken(guestToken)) throw new ForbiddenException('Invalid guest token');
    await this.prisma.routineDraft.update({ where: { id: draftId }, data: { customerId, guestTokenHash: null } });
    return this.getDraft(draftId, { customerId });
  }

  verifyOwnership(draft: { customerId: string | null; guestTokenHash: string | null }, owner: DraftOwner) {
    if (draft.customerId) {
      if (draft.customerId !== owner.customerId) throw new ForbiddenException('Not authorized to access this draft');
      return;
    }
    if (!owner.guestToken || !draft.guestTokenHash || this.hashToken(owner.guestToken) !== draft.guestTokenHash) {
      throw new ForbiddenException('Draft requires its guest token');
    }
  }

  private async casUpdate(draftId: string, version: number, data: Prisma.RoutineDraftUpdateManyMutationInput) {
    const updated = await this.prisma.routineDraft.updateMany({ where: { id: draftId, version }, data });
    if (updated.count === 0) throw new ConflictException({ code: 'DRAFT_VERSION_CONFLICT', message: 'Draft has been updated by another request' });
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
