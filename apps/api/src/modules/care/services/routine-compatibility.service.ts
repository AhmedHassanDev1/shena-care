import { Injectable } from '@nestjs/common';
import { IngredientRuleStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, CareProductFacts, SkuReferenceService } from '../../catalog/public';
import { CommerceService } from '../../commerce/public';
import { checkRoutine, CompatibilityResult, CompatibilityRule, CompatibilitySafety, CompatibilityStep } from '../engine/routine-compatibility';

export const UNKNOWN_COMPATIBILITY_SAFETY: CompatibilitySafety = { pregnant: 'UNKNOWN', breastfeeding: 'UNKNOWN', prescriptionTopical: 'UNKNOWN', oralRetinoid: 'UNKNOWN' };

/** Loads the rules, product facts and availability for a routine and runs the shared compatibility check. Read-only. */
@Injectable()
export class RoutineCompatibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly skuRefs: SkuReferenceService,
    private readonly commerce: CommerceService,
  ) {}

  /** Every active ingredient rule with its source (care.ingredient_rules). */
  async rules(): Promise<CompatibilityRule[]> {
    const rows = await this.prisma.ingredientRule.findMany({ where: { status: IngredientRuleStatus.ACTIVE }, orderBy: { key: 'asc' } });
    return rows.map(row => ({
      key: row.key, kind: row.kind, subjectType: row.subjectType, subject: row.subject, otherType: row.otherType, other: row.other,
      condition: row.condition, noteAr: row.noteAr, sourceTitle: row.sourceTitle, sourceUrl: row.sourceUrl,
    }));
  }

  /** The safety answers saved on the customer's care profile; everything unanswered stays UNKNOWN. */
  async savedSafety(customerId: string | null | undefined): Promise<CompatibilitySafety> {
    if (!customerId) return { ...UNKNOWN_COMPATIBILITY_SAFETY };
    const profile = await this.prisma.customerCareProfile.findUnique({ where: { customerId }, select: { safetyFlags: true } });
    const flags = profile?.safetyFlags;
    return flags
      ? { pregnant: flags.pregnant, breastfeeding: flags.breastfeeding, prescriptionTopical: flags.prescriptionTopical, oralRetinoid: flags.oralRetinoid }
      : { ...UNKNOWN_COMPATIBILITY_SAFETY };
  }

  async check(steps: CompatibilityStep[], safety: CompatibilitySafety): Promise<CompatibilityResult> {
    const skuIds = [...new Set(steps.map(step => step.skuId))];
    // Catalog owns SKU identity: resolve through its public reference service, never its tables.
    const skuRows = [...(await this.skuRefs.facts(skuIds)).values()].map(fact => ({ id: fact.skuId, productId: fact.productId }));
    const [facts, terms, rules] = await Promise.all([
      this.catalog.getCareProductFacts({ productIds: skuRows.map(row => row.productId) }),
      this.commerce.getSellingTermsBatch(skuIds),
      this.rules(),
    ]);
    const byProduct = new Map(facts.map(fact => [fact.productId, fact]));
    const products = new Map<string, CareProductFacts>();
    for (const row of skuRows) {
      const fact = byProduct.get(row.productId);
      if (fact) products.set(row.id, fact);
    }
    const availability = new Map(skuIds.map(id => [id, terms.get(id)?.canOrder === true]));
    return checkRoutine(steps, products, availability, rules, safety);
  }
}
