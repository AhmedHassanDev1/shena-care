import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, RoutineProposal, RoutineProposalStatus, RoutinePurchasePhase, RoutineTier } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RoutineProductFacts } from '../../catalog/public';
import { ProposalActionDto, SaveProposalDto } from '../dto/routine-workspace.dto';
import { buildProposal, EngineProposal, ENGINE_VERSION, selectBlueprint } from '../engine/routine-engine';
import { readSafety, RoutineEngineService } from './routine-engine.service';
import { DraftOwner, RoutineWorkspaceService } from './routine-workspace.service';
import { MyRoutinesService } from './my-routines.service';

/** The frozen record kept with every saved routine version (§10, «الـ IDs لوحدها مش كفاية»). */
export function versionSnapshot(proposal: EngineProposal, facts: Map<string, RoutineProductFacts>, extra: Record<string, unknown>) {
  const selected = proposal.items.filter(i => i.status === 'SELECTED' && i.product);
  return {
    engineVersion: proposal.engineVersion,
    blueprint: proposal.blueprint,
    mode: proposal.mode,
    tier: proposal.tier,
    warnings: proposal.warnings,
    totals: proposal.totals,
    items: proposal.items.map(i => ({
      roleKey: i.roleKey, titleAr: i.titleAr, status: i.status, isEssential: i.isEssential, startWeek: i.startWeek,
      purchasePhase: i.purchasePhase, product: i.product, reasonCodes: i.reasonCodes, usageNoteAr: i.usageNoteAr,
    })),
    facts: Object.fromEntries(selected.map(i => {
      const f = facts.get(i.product!.productId);
      return [i.product!.productId, f ? {
        actives: f.actives,
        ingredientSlugs: f.ingredientSlugs,
        usageRules: f.usageRules.filter(r => r.skuId === null || r.skuId === i.product!.skuId),
      } : null];
    })),
    ...extra,
  };
}

@Injectable()
export class RoutineProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: RoutineEngineService,
    private readonly workspace: RoutineWorkspaceService,
    private readonly myRoutines: MyRoutinesService,
  ) {}

  /** Runs the engine on the draft as it is now and stores the result as the draft's current proposal. */
  async generateProposal(draftId: string, owner: DraftOwner): Promise<RoutineProposal> {
    const draft = await this.workspace.loadOwnedDraft(draftId, owner);
    const { proposal } = await this.run(draft);
    return this.prisma.routineProposal.create({
      data: {
        draftId: draft.id,
        status: RoutineProposalStatus.proposed,
        snapshot: proposal as unknown as Prisma.InputJsonValue,
        totalPrice: proposal.totals.all,
        draftVersion: draft.version,
        engineVersion: ENGINE_VERSION,
        error: Prisma.DbNull,
      },
    });
  }

  async applyAction(draftId: string, dto: ProposalActionDto, owner: DraftOwner) {
    await this.workspace.applyAction(draftId, dto, owner);
    return this.generateProposal(draftId, owner);
  }

  /**
   * Saves the current proposal as the customer's routine. Idempotent per proposal. Re-runs the engine first:
   * when stock or prices moved since the proposal, nothing is saved and the fresh proposal is returned to confirm.
   */
  async saveProposal(proposalId: string, customerId: string, dto: SaveProposalDto) {
    const proposal = await this.prisma.routineProposal.findUnique({ where: { id: proposalId }, include: { draft: true } });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.draft.customerId !== customerId) {
      throw new ForbiddenException('Sign in and link the draft before saving the routine');
    }

    const existing = await this.prisma.customerRoutine.findUnique({ where: { createdFromProposalId: proposalId } });
    if (existing) return this.myRoutines.getRoutine(existing.id, customerId);

    if (proposal.status !== RoutineProposalStatus.proposed) {
      throw new BadRequestException(`Cannot save a proposal with status ${proposal.status}`);
    }
    if (proposal.draftVersion !== proposal.draft.version) {
      throw new ConflictException({ code: 'PROPOSAL_OUTDATED', message: 'The draft changed after this proposal; use the latest one.' });
    }

    const { proposal: fresh, facts } = await this.run(proposal.draft);
    const stored = proposal.snapshot as unknown as EngineProposal;
    if (fingerprint(fresh) !== fingerprint(stored)) {
      const replacement = await this.prisma.routineProposal.create({
        data: { draftId: proposal.draftId, status: RoutineProposalStatus.proposed, snapshot: fresh as unknown as Prisma.InputJsonValue,
          totalPrice: fresh.totals.all, draftVersion: proposal.draft.version, engineVersion: ENGINE_VERSION, error: Prisma.DbNull },
      });
      throw new ConflictException({ code: 'PROPOSAL_CHANGED', message: 'Availability or prices changed; review the updated routine.', proposalId: replacement.id });
    }
    if (fresh.items.some(i => i.isEssential && (i.status === 'UNAVAILABLE' || i.status === 'UPGRADE_AVAILABLE'))) {
      throw new UnprocessableEntityException({ code: 'ESSENTIAL_STEP_MISSING', message: 'Every essential step needs a product or "I have it" first.' });
    }

    const draft = proposal.draft;
    const safety = readSafety(draft.safety);
    let routineId: string;
    try {
      routineId = await this.prisma.$transaction(async tx => {
        const profile = await tx.customerCareProfile.upsert({
          where: { customerId },
          create: { customerId, skinType: draft.skinType, ageBand: draft.ageBand, experienceLevel: draft.experienceLevel,
            fragranceFree: draft.fragranceFree },
          update: { skinType: draft.skinType ?? undefined, ageBand: draft.ageBand ?? undefined,
            experienceLevel: draft.experienceLevel ?? undefined, fragranceFree: draft.fragranceFree ?? undefined },
        });
        if (draft.consentVersion && draft.consentAt && draft.ageBand !== 'UNDER_15') {
          const flags = { ...safety, allergyIngredientIds: draft.allergyIngredientIds, consentVersion: draft.consentVersion, consentAt: draft.consentAt };
          await tx.careSafetyFlags.upsert({ where: { careProfileId: profile.id }, create: { careProfileId: profile.id, ...flags }, update: flags });
        }
        const routine = await tx.customerRoutine.create({
          data: {
            careProfileId: profile.id,
            blueprintId: fresh.blueprint.id,
            blueprintVersion: fresh.blueprint.version,
            concernSlug: fresh.blueprint.concernSlug,
            careArea: fresh.blueprint.careArea,
            kind: fresh.blueprint.kind,
            titleAr: fresh.blueprint.titleAr,
            tier: fresh.tier as RoutineTier,
            budget: draft.budget,
            createdFromProposalId: proposal.id,
            items: {
              create: fresh.items.filter(i => i.status === 'SELECTED' || i.status === 'OWNED').map(i => ({
                roleKey: i.roleKey, sortOrder: i.sortOrder, isEssential: i.isEssential,
                productId: i.product?.productId ?? null, skuId: i.product?.skuId ?? null,
                tier: (i.product?.tier as RoutineTier | undefined) ?? null,
                isOwned: i.status === 'OWNED',
                purchasePhase: i.purchasePhase as RoutinePurchasePhase, startWeek: i.startWeek,
                reasonCodes: i.reasonCodes, addedAtVersion: 1,
              })),
            },
            versions: {
              create: {
                version: 1,
                snapshot: versionSnapshot(fresh, facts, {
                  safetyAnswers: draft.ageBand === 'UNDER_15' ? null : safety,
                  answers: { severity: draft.severity, skinType: draft.skinType, ageBand: draft.ageBand, budget: draft.budget },
                }) as unknown as Prisma.InputJsonValue,
              },
            },
          },
        });
        const marked = await tx.routineProposal.updateMany({
          where: { id: proposal.id, status: RoutineProposalStatus.proposed }, data: { status: RoutineProposalStatus.accepted },
        });
        if (marked.count === 0) throw new ConflictException('Proposal already saved concurrently');
        return routine.id;
      });
    } catch (error) {
      // A concurrent save of the same proposal won the unique createdFromProposalId: return that routine.
      const winner = await this.prisma.customerRoutine.findUnique({ where: { createdFromProposalId: proposalId } });
      if (winner) return this.myRoutines.getRoutine(winner.id, customerId);
      throw error;
    }

    if (dto.activate !== false) {
      const result = await this.myRoutines.tryActivate(routineId, customerId, []);
      return { ...(await this.myRoutines.getRoutine(routineId, customerId)), activationResult: result };
    }
    return this.myRoutines.getRoutine(routineId, customerId);
  }

  /** What a guest or customer can put in the cart straight from the current proposal (§5.5). */
  async purchasableFromProposal(proposalId: string, owner: DraftOwner, phase: 'IMMEDIATE' | 'ALL') {
    const proposal = await this.prisma.routineProposal.findUnique({ where: { id: proposalId }, include: { draft: true } });
    if (!proposal) throw new NotFoundException('Proposal not found');
    this.workspace.verifyOwnership(proposal.draft, owner);
    if (proposal.draftVersion !== proposal.draft.version) {
      throw new ConflictException({ code: 'PROPOSAL_OUTDATED', message: 'The draft changed after this proposal; use the latest one.' });
    }
    const snapshot = proposal.snapshot as unknown as EngineProposal;
    return snapshot.items
      .filter(i => i.status === 'SELECTED' && i.product?.skuId)
      .filter(i => phase === 'ALL' || i.purchasePhase === 'IMMEDIATE')
      .map(i => ({ roleKey: i.roleKey, productId: i.product!.productId, skuId: i.product!.skuId! }));
  }

  private async run(draft: Prisma.RoutineDraftGetPayload<object>) {
    if (!draft.primaryConcern) {
      throw new UnprocessableEntityException({ code: 'CONCERN_REQUIRED', message: 'Pick the concern first.' });
    }
    const blueprints = await this.engine.publishedBlueprints(draft.primaryConcern);
    const blueprint = selectBlueprint(blueprints, draft.primaryConcern, draft.severity ?? null);
    if (!blueprint) {
      throw new UnprocessableEntityException({ code: 'CONCERN_NOT_AVAILABLE', message: 'No published routine for this concern yet.' });
    }
    const profile = draft.customerId
      ? await this.prisma.customerCareProfile.findUnique({ where: { customerId: draft.customerId }, select: { id: true } })
      : null;
    const [{ candidates, facts }, rules, activeProducts] = await Promise.all([
      this.engine.candidatesFor(blueprint),
      this.engine.activeRules(),
      this.engine.activeRoutineProducts(profile?.id ?? null),
    ]);
    const proposal = buildProposal(blueprint, candidates, rules, this.engine.contextFromDraft(draft, activeProducts));
    return { proposal, facts };
  }
}

/** What must not change silently between showing a routine and saving it. */
function fingerprint(p: EngineProposal) {
  return JSON.stringify({
    blueprint: [p.blueprint.id, p.blueprint.version], tier: p.tier, mode: p.mode,
    items: p.items.map(i => [i.roleKey, i.status, i.product?.productId ?? null, i.product?.skuId ?? null, i.product?.price ?? null, i.purchasePhase]),
  });
}
