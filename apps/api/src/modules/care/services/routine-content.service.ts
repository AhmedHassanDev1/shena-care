import { Injectable } from '@nestjs/common';
import { Prisma, RecommendationSource, RoutineTiming } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CommerceService } from '../../commerce/public';
import { SkuReference, SkuReferenceService, SkuRoutineFacts } from '../../catalog/public';

type Tx = Prisma.TransactionClient;

export const API_TIMINGS = ['AM', 'PM', 'AS_NEEDED'] as const;
export type ApiTiming = (typeof API_TIMINGS)[number];
const TO_DB: Record<ApiTiming, RoutineTiming> = { AM: 'am', PM: 'pm', AS_NEEDED: 'as_needed' };
const FROM_DB: Record<RoutineTiming, string> = { am: 'AM', pm: 'PM', as_needed: 'AS_NEEDED', both: 'BOTH' };
export const toDbTiming = (timing: ApiTiming): RoutineTiming => TO_DB[timing];

/** What a customer or reviewer may rely on for one product reference. Unavailable products are shown as such, never swapped. */
export type ProductState = 'AVAILABLE' | 'UNAVAILABLE' | 'UNPUBLISHED' | 'INACTIVE' | 'MISSING' | 'UNKNOWN_VARIANT';

export interface ProductView {
  skuId: string | null; productId: string; state: ProductState
  productName: string | null; brandName: string | null; skuCode: string | null; variantName: string | null
  size: number | null; sizeUnit: string | null
  price: { amount: number; currency: string; compareAtAmount: number | null } | null
}

export interface StepView {
  id: string; order: number; timing: string; title: string; instructions: string | null; reason: string | null; isOptional: boolean
  product: ProductView | null; alternatives: ProductView[]
}

export interface RoutineView {
  id: string; title: string; titleEn: string | null; description: string | null; careArea: string; concernSlug: string | null
  isTemplate: boolean; status: string; origin: string; version: number; sourceRoutineId: string | null
  references: Array<{ title: string; url: string }>; publishedAt: Date | null; createdAt: Date; updatedAt: Date; steps: StepView[]
}

/** One resolved step ready to be stored. */
export interface ResolvedStep {
  title: string; timing: ApiTiming; instructions: string | null; reason: string | null; isOptional: boolean
  product: { skuId: string; productId: string }; alternatives: Array<{ skuId: string; productId: string }>
  source: RecommendationSource
}

@Injectable()
export class RoutineContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skuRefs: SkuReferenceService,
    private readonly commerce: CommerceService,
  ) {}

  resolveReference(reference: SkuReference) { return this.skuRefs.resolve(reference); }
  facts(skuIds: string[]) { return this.skuRefs.facts(skuIds); }

  /** Current sellability of each SKU: the commerce listing and price are the only source of "can be bought". */
  async states(skuIds: string[]): Promise<Map<string, ProductView>> {
    const ids = [...new Set(skuIds)];
    const [facts, terms] = await Promise.all([this.skuRefs.facts(ids), this.commerce.getSellingTermsBatch(ids)]);
    const views = new Map<string, ProductView>();
    for (const id of ids) {
      const fact = facts.get(id);
      if (!fact) { views.set(id, missingView(id)); continue; }
      const term = terms.get(id);
      const state: ProductState = !fact.isActive ? 'INACTIVE' : !fact.isPublished ? 'UNPUBLISHED' : !term?.canOrder ? 'UNAVAILABLE' : 'AVAILABLE';
      views.set(id, view(fact, state, state === 'AVAILABLE' || state === 'UNAVAILABLE' ? term?.price ?? null : null));
    }
    return views;
  }

  async present(routineId: string, db: Tx | PrismaService = this.prisma): Promise<RoutineView | null> {
    const routine = await db.routine.findUnique({ where: { id: routineId }, include: { steps: { orderBy: { stepOrder: 'asc' }, include: { recommendations: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } } } } });
    if (!routine) return null;
    const skuIds = routine.steps.flatMap(step => step.recommendations.map(rec => rec.skuId).filter((id): id is string => !!id));
    const states = await this.states(skuIds);
    const legacyProducts = await this.legacyProductNames(routine.steps.flatMap(step => step.recommendations.filter(rec => !rec.skuId).map(rec => rec.productId)));
    const productView = (rec: { skuId: string | null; productId: string }): ProductView => rec.skuId
      ? { ...(states.get(rec.skuId) ?? missingView(rec.skuId)), productId: rec.productId }
      : { ...missingView(null), productId: rec.productId, state: 'UNKNOWN_VARIANT', productName: legacyProducts.get(rec.productId) ?? null };
    return {
      id: routine.id, title: routine.title, titleEn: routine.titleEn, description: routine.description, careArea: routine.careArea,
      concernSlug: routine.concernSlug, isTemplate: routine.isTemplate, status: routine.status, origin: routine.origin, version: routine.version,
      sourceRoutineId: routine.sourceRoutineId, references: (routine.references as Array<{ title: string; url: string }> | null) ?? [],
      publishedAt: routine.publishedAt, createdAt: routine.createdAt, updatedAt: routine.updatedAt,
      steps: routine.steps.map(step => {
        // The default row sorts first; a step whose product was removed from the catalog has none and is shown as missing.
        const [main, ...rest] = step.recommendations;
        return {
          id: step.id, order: step.stepOrder, timing: FROM_DB[step.timing], title: step.title, instructions: step.instructions, reason: step.reason,
          isOptional: step.isOptional, product: main ? productView(main) : null, alternatives: rest.map(productView),
        };
      }),
    };
  }

  private async legacyProductNames(productIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(productIds)];
    if (!ids.length) return new Map();
    const rows = await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(rows.map(row => [row.id, row.name]));
  }

  /** Replaces all steps (and their product rows) of a routine inside the caller's transaction. */
  async writeSteps(tx: Tx, routineId: string, steps: ResolvedStep[]): Promise<void> {
    await tx.routineStep.deleteMany({ where: { routineId } });
    let order = 0;
    for (const step of steps) {
      await tx.routineStep.create({ data: {
        routineId, title: step.title, instructions: step.instructions, reason: step.reason, stepOrder: order++, timing: toDbTiming(step.timing),
        isOptional: step.isOptional,
        recommendations: { create: [
          { productId: step.product.productId, skuId: step.product.skuId, isDefault: true, source: step.source },
          ...step.alternatives.map(alt => ({ productId: alt.productId, skuId: alt.skuId, isDefault: false, source: step.source })),
        ] },
      } });
    }
  }

  /** Frozen content for the revision log (references only, no live availability). */
  async snapshot(routineId: string, db: Tx | PrismaService = this.prisma): Promise<Prisma.InputJsonValue> {
    const routine = await db.routine.findUniqueOrThrow({ where: { id: routineId }, include: { steps: { orderBy: { stepOrder: 'asc' }, include: { recommendations: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } } } } });
    return JSON.parse(JSON.stringify({
      title: routine.title, titleEn: routine.titleEn, description: routine.description, careArea: routine.careArea, concernSlug: routine.concernSlug,
      status: routine.status, version: routine.version, references: routine.references,
      steps: routine.steps.map(step => ({ title: step.title, timing: FROM_DB[step.timing], instructions: step.instructions, reason: step.reason, isOptional: step.isOptional,
        products: step.recommendations.map(rec => ({ skuId: rec.skuId, productId: rec.productId, isDefault: rec.isDefault })) })),
    })) as Prisma.InputJsonValue;
  }

  async revise(tx: Tx, routineId: string, action: string, actorId: string): Promise<void> {
    const routine = await tx.routine.findUniqueOrThrow({ where: { id: routineId }, select: { version: true } });
    await tx.routineRevision.create({ data: { routineId, version: routine.version, action, actorId, snapshot: await this.snapshot(routineId, tx) } });
  }
}

function view(fact: SkuRoutineFacts, state: ProductState, price: ProductView['price']): ProductView {
  return { skuId: fact.skuId, productId: fact.productId, state, productName: fact.productName, brandName: fact.brandName, skuCode: fact.skuCode,
    variantName: fact.variantName, size: fact.size, sizeUnit: fact.sizeUnit, price: price ? { amount: price.amount, currency: price.currency, compareAtAmount: price.compareAtAmount } : null };
}

function missingView(skuId: string | null): ProductView {
  return { skuId, productId: '', state: 'MISSING', productName: null, brandName: null, skuCode: null, variantName: null, size: null, sizeUnit: null, price: null };
}
