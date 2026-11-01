import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { BlueprintStatus, EligibilityReviewStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { EligibilityDto } from '../dto/routine-workspace.dto';
import {
  buildProposal, EngineBlueprint, EngineCandidate, EngineContext, EngineRule, exclusionFor, Tier, TIERS,
} from '../engine/routine-engine';
import { RoutineEngineService, toEngineBlueprint, UNKNOWN_SAFETY } from './routine-engine.service';

/** Products an essential role needs per tier before a blueprint may publish (§13 catalog readiness gate). */
export const MIN_PRODUCTS_PER_ESSENTIAL_ROLE = 2;

function neutralContext(over: Partial<EngineContext> = {}): EngineContext {
  return {
    severity: null, skinType: null, ageBand: null, experienceLevel: 'BEGINNER', fragranceFree: null, safety: UNKNOWN_SAFETY,
    allergyIngredientIds: [], tier: null, budget: null, ownedRoleKeys: [], overrides: { swaps: {}, removed: [], upgrades: [] },
    activeRoutineProducts: [], now: new Date(), ...over,
  };
}

/** Ready-made routines, the readiness gate, publishing and product-role approval. */
@Injectable()
export class RoutineCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: RoutineEngineService,
  ) {}

  /**
   * Ready-made routines for discovery. Built with every safety answer unknown, so nothing a safety question could
   * rule out is shown; the builder personalises it after the questions.
   */
  async featured(concernSlug?: string) {
    const blueprints = await this.engine.publishedBlueprints(concernSlug);
    const rules = await this.engine.activeRules();
    const out = [];
    for (const bp of blueprints) {
      const { candidates } = await this.engine.candidatesFor(bp);
      const base = buildProposal(bp, candidates, rules, neutralContext());
      const tiers = base.tiersAvailable.map(tier => {
        const p = buildProposal(bp, candidates, rules, neutralContext({ tier }));
        return {
          tier,
          totals: p.totals,
          complete: !p.items.some(i => i.isEssential && i.status !== 'SELECTED'),
          items: p.items.map(i => ({ roleKey: i.roleKey, titleAr: i.titleAr, isEssential: i.isEssential, startWeek: i.startWeek,
            status: i.status, product: i.product, reasonCodes: i.reasonCodes })),
        };
      }).filter(t => t.complete);
      if (tiers.length) {
        out.push({ blueprint: base.blueprint, preview: true, warnings: base.warnings, tiers });
      }
    }
    return out;
  }

  /** Per blueprint and tier: does every essential role have enough approved, complete, sellable products? */
  async readiness() {
    const rows = await this.prisma.routineBlueprint.findMany({ include: { roles: true }, orderBy: { key: 'asc' } });
    const rules = await this.engine.activeRules();
    const out = [];
    for (const row of rows) {
      const bp = toEngineBlueprint(row);
      const { candidates } = await this.engine.candidatesFor(bp);
      out.push({
        id: bp.id, key: bp.key, status: row.status, concernSlug: bp.concernSlug,
        hasSources: Array.isArray(row.sources) && (row.sources as unknown[]).length > 0,
        tiers: Object.fromEntries(TIERS.map(tier => [tier, this.tierReadiness(bp, candidates, rules, tier)])),
      });
    }
    return out;
  }

  async publish(blueprintId: string, adminId: string) {
    const row = await this.prisma.routineBlueprint.findUnique({ where: { id: blueprintId }, include: { roles: true } });
    if (!row) throw new NotFoundException('Blueprint not found');
    if (!Array.isArray(row.sources) || !(row.sources as unknown[]).length) {
      throw new UnprocessableEntityException({ code: 'SOURCES_REQUIRED', message: 'Every blueprint needs its published sources first.' });
    }
    const bp = toEngineBlueprint(row);
    const { candidates } = await this.engine.candidatesFor(bp);
    const smart = this.tierReadiness(bp, candidates, await this.engine.activeRules(), 'SMART');
    if (!smart.ready) {
      throw new UnprocessableEntityException({ code: 'CATALOG_NOT_READY', message: 'The smart pick lacks products for essential steps.', missing: smart.missing });
    }
    return this.prisma.routineBlueprint.update({
      where: { id: blueprintId },
      data: { status: BlueprintStatus.PUBLISHED, publishedAt: new Date(), publishedBy: adminId,
        ...(row.status === BlueprintStatus.PUBLISHED ? {} : { version: row.publishedAt ? row.version + 1 : row.version }) },
    });
  }

  async retire(blueprintId: string) {
    const row = await this.prisma.routineBlueprint.findUnique({ where: { id: blueprintId } });
    if (!row) throw new NotFoundException('Blueprint not found');
    return this.prisma.routineBlueprint.update({ where: { id: blueprintId }, data: { status: BlueprintStatus.RETIRED } });
  }

  /** Approves (or rejects) a product for one role. The role must exist in some blueprint. */
  async upsertEligibility(dto: EligibilityDto, adminId: string) {
    const role = await this.prisma.blueprintRole.findFirst({ where: { roleKey: dto.roleKey }, select: { id: true } });
    if (!role) throw new BadRequestException(`Unknown role ${dto.roleKey}`);
    const status = (dto.reviewStatus ?? 'APPROVED') as EligibilityReviewStatus;
    const reviewed = status === EligibilityReviewStatus.PENDING ? { reviewedBy: null, reviewedAt: null } : { reviewedBy: adminId, reviewedAt: new Date() };
    const data = { tier: dto.tier, concernSlugs: dto.concernSlugs, suitableSkinTypes: dto.suitableSkinTypes ?? [], reviewStatus: status, ...reviewed };
    return this.prisma.productRoleEligibility.upsert({
      where: { productId_roleKey: { productId: dto.productId, roleKey: dto.roleKey } },
      create: { productId: dto.productId, roleKey: dto.roleKey, ...data },
      update: data,
    });
  }

  async listRules() {
    return this.prisma.ingredientRule.findMany({ orderBy: [{ kind: 'asc' }, { key: 'asc' }] });
  }

  async listBlueprints() {
    return this.prisma.routineBlueprint.findMany({ include: { roles: { orderBy: { sortOrder: 'asc' } } }, orderBy: { key: 'asc' } });
  }

  private tierReadiness(bp: EngineBlueprint, candidates: EngineCandidate[], rules: EngineRule[], tier: Tier) {
    // Catalog-level check: customer restrictions off, product data requirements on.
    const ctx = neutralContext({ safety: { pregnant: 'NO', breastfeeding: 'NO', prescriptionTopical: 'NO', oralRetinoid: 'NO', fragranceSensitive: 'NO' }, ageBand: 'ADULT' });
    const missing = bp.roles.filter(r => r.isEssential).map(role => {
      const qualified = candidates.filter(c => c.roleKey === role.roleKey && c.tier === tier && exclusionFor(c, role, bp, ctx, rules, []) === null);
      return { roleKey: role.roleKey, qualified: qualified.length, sellable: qualified.filter(c => c.sellable && c.price !== null).length };
    }).filter(r => r.sellable < MIN_PRODUCTS_PER_ESSENTIAL_ROLE);
    return { ready: missing.length === 0, missing };
  }
}
