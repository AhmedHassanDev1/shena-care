import { Injectable } from '@nestjs/common';
import { BlueprintStatus, EligibilityReviewStatus, IngredientRuleStatus, Prisma, RoutineActivation } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, RoutineProductFacts } from '../../catalog/public';
import { CommerceService } from '../../commerce/public';
import {
  ActiveRoutineProduct, AgeBand, EngineBlueprint, EngineCandidate, EngineContext, EngineOverrides, EngineRule, SafetyAnswers, Tier,
  TriState,
} from '../engine/routine-engine';

export const UNKNOWN_SAFETY: SafetyAnswers = {
  pregnant: 'UNKNOWN', breastfeeding: 'UNKNOWN', prescriptionTopical: 'UNKNOWN', oralRetinoid: 'UNKNOWN', fragranceSensitive: 'UNKNOWN',
};
const SAFETY_KEYS = Object.keys(UNKNOWN_SAFETY) as Array<keyof SafetyAnswers>;

type BlueprintWithRoles = Prisma.RoutineBlueprintGetPayload<{ include: { roles: true } }>;

/** Reads a stored safety answer set; anything missing or malformed is UNKNOWN, never NO (§8-ب). */
export function readSafety(raw: unknown): SafetyAnswers {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...UNKNOWN_SAFETY };
  for (const key of SAFETY_KEYS) {
    const v = value[key];
    if (v === 'YES' || v === 'NO' || v === 'UNKNOWN') out[key] = v as TriState;
  }
  return out;
}

export function readOverrides(raw: unknown): EngineOverrides {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const swaps: Record<string, string> = {};
  if (value.swaps && typeof value.swaps === 'object') {
    for (const [k, v] of Object.entries(value.swaps as Record<string, unknown>)) if (typeof v === 'string') swaps[k] = v;
  }
  return { swaps, removed: strings(value.removed), upgrades: strings(value.upgrades) };
}

export function toEngineBlueprint(bp: BlueprintWithRoles): EngineBlueprint {
  return {
    id: bp.id, key: bp.key, version: bp.version, concernSlug: bp.concernSlug, careArea: bp.careArea, kind: bp.kind,
    severityMin: bp.severityMin, severityMax: bp.severityMax, titleAr: bp.titleAr, goalAr: bp.goalAr, timelineAr: bp.timelineAr,
    safetyNotesAr: bp.safetyNotesAr,
    roles: bp.roles.map(r => ({
      roleKey: r.roleKey, sortOrder: r.sortOrder, titleAr: r.titleAr, isEssential: r.isEssential, startWeek: r.startWeek,
      requiredActives: r.requiredActives,
      concentrationRanges: Array.isArray(r.concentrationRanges)
        ? (r.concentrationRanges as Array<{ subject: string; min: number; max: number; unit: string }>) : [],
      usageNoteAr: r.usageNoteAr,
    })),
  };
}

/** Loads everything the pure engine needs from the owning modules: no business rule lives here. */
@Injectable()
export class RoutineEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly commerce: CommerceService,
  ) {}

  async publishedBlueprints(concernSlug?: string): Promise<EngineBlueprint[]> {
    const rows = await this.prisma.routineBlueprint.findMany({
      where: { status: BlueprintStatus.PUBLISHED, ...(concernSlug && { concernSlug }) },
      include: { roles: true },
      orderBy: [{ concernSlug: 'asc' }, { severityMin: 'asc' }, { key: 'asc' }],
    });
    return rows.map(toEngineBlueprint);
  }

  async blueprintById(id: string): Promise<EngineBlueprint | null> {
    const row = await this.prisma.routineBlueprint.findUnique({ where: { id }, include: { roles: true } });
    return row ? toEngineBlueprint(row) : null;
  }

  async activeRules(): Promise<EngineRule[]> {
    const rows = await this.prisma.ingredientRule.findMany({ where: { status: IngredientRuleStatus.ACTIVE }, orderBy: { key: 'asc' } });
    return rows.map(r => ({ key: r.key, kind: r.kind, subjectType: r.subjectType, subject: r.subject, otherType: r.otherType,
      other: r.other, condition: r.condition, noteAr: r.noteAr }));
  }

  /** Approved products for the blueprint's roles, with reviewed facts and current sellability. */
  async candidatesFor(bp: EngineBlueprint): Promise<{ candidates: EngineCandidate[]; facts: Map<string, RoutineProductFacts> }> {
    const eligibility = await this.prisma.productRoleEligibility.findMany({
      where: { roleKey: { in: bp.roles.map(r => r.roleKey) }, reviewStatus: EligibilityReviewStatus.APPROVED },
      orderBy: [{ roleKey: 'asc' }, { productId: 'asc' }],
    });
    const facts = new Map((await this.catalog.getRoutineProductFacts(eligibility.map(e => e.productId))).map(f => [f.productId, f]));
    const offers = new Map<string, { skuId: string | null; price: number | null; currency: string; sellable: boolean }>();
    for (const f of facts.values()) offers.set(f.productId, await this.bestOffer(f));

    const candidates: EngineCandidate[] = [];
    for (const e of eligibility) {
      const f = facts.get(e.productId);
      if (!f) continue; // unpublished or removed from the catalog
      const offer = offers.get(e.productId)!;
      const rules = f.usageRules.filter(r => r.skuId === null || r.skuId === offer.skuId);
      candidates.push({
        productId: f.productId, skuId: offer.skuId, name: f.name, brandName: f.brandName, imageUrl: f.imageUrl,
        roleKey: e.roleKey, tier: e.tier as Tier, concernSlugs: e.concernSlugs, suitableSkinTypes: e.suitableSkinTypes,
        price: offer.price, currency: offer.currency, sellable: offer.sellable, actives: f.actives,
        ingredientIds: f.ingredientIds, ingredientSlugs: f.ingredientSlugs, ingredientFamilies: f.ingredientFamilies,
        usageRuleCount: rules.length,
        factsReviewedAt: [...rules.map(r => r.reviewedAt), ...f.actives.map(a => a.concentrationReviewedAt).filter((d): d is string => !!d)],
        safetyWarnings: f.safetyWarnings?.map(w => ({ kind: w.kind, condition: w.condition })),
      });
    }
    return { candidates, facts };
  }

  /** First active SKU that can be ordered now; otherwise the first active SKU, marked not sellable. */
  private async bestOffer(f: RoutineProductFacts) {
    const skus = f.skus.filter(s => s.isActive).sort((a, b) => a.id.localeCompare(b.id));
    for (const sku of skus) {
      const evaluation = await this.commerce.evaluateSellability(sku.id);
      if (evaluation.isSellable && evaluation.terms?.price) {
        return { skuId: sku.id, price: evaluation.terms.price.amount, currency: evaluation.terms.price.currency, sellable: true };
      }
    }
    return { skuId: skus[0]?.id ?? null, price: null, currency: 'EGP', sellable: false };
  }

  /** Products in the profile's ACTIVE routines, for cross-routine conflicts and role reuse (§5.6). */
  async activeRoutineProducts(careProfileId: string | null, exceptRoutineId?: string): Promise<ActiveRoutineProduct[]> {
    if (!careProfileId) return [];
    const routines = await this.prisma.customerRoutine.findMany({
      where: { careProfileId, activation: RoutineActivation.ACTIVE, ...(exceptRoutineId && { id: { not: exceptRoutineId } }) },
      include: { items: { where: { removedAtVersion: null } } },
    });
    const productIds = routines.flatMap(r => r.items.map(i => i.productId).filter((id): id is string => !!id));
    const facts = new Map((await this.catalog.getRoutineProductFacts(productIds)).map(f => [f.productId, f]));
    return routines.flatMap(r => r.items.filter(i => i.productId).map(i => {
      const f = facts.get(i.productId!);
      return {
        routineId: r.id, careArea: r.careArea, roleKey: i.roleKey, productId: i.productId!,
        subjects: f ? [...new Set([...f.ingredientSlugs, ...f.ingredientFamilies])].sort() : [],
      };
    }));
  }

  contextFromDraft(
    draft: Prisma.RoutineDraftGetPayload<object>,
    activeRoutineProducts: ActiveRoutineProduct[],
    now = new Date(),
  ): EngineContext {
    return {
      severity: draft.severity ?? null,
      skinType: draft.skinType ?? null,
      ageBand: (draft.ageBand as AgeBand | null) ?? null,
      experienceLevel: draft.experienceLevel ?? null,
      fragranceFree: draft.fragranceFree ?? null,
      safety: draft.ageBand === 'UNDER_15' ? UNKNOWN_SAFETY : readSafety(draft.safety),
      allergyIngredientIds: draft.allergyIngredientIds ?? [],
      tier: (draft.tier as Tier | null) ?? null,
      budget: draft.budget === null || draft.budget === undefined ? null : Number(draft.budget),
      ownedRoleKeys: draft.ownedRoleKeys ?? [],
      overrides: readOverrides(draft.overrides),
      activeRoutineProducts,
      now,
    };
  }
}
