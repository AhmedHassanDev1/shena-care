import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../../catalog/public';
import { SourcingService } from '../../sourcing/public';
import { IngestionImportMode, IngestionPriceType, IngestionStatus, Prisma } from '@prisma/client';
import {
  RowDiffAction,
  RowDiff,
  JobDiffSummary,
  CommitJobOptions,
  CommitJobResult,
  ItemCommitOutcome,
  ApproveDeactivationsOptions,
  SourceRowSummary,
} from '../contracts/offer-batch-commit.contract';

/** When a supplier row's information was true, as far as the source tells us (all ISO strings). */
export interface SourceTiming {
  /** Supplier-reported row effective/export time (mapped column); advisory but comparable within one supplier. */
  sourceObservedAt: string | null;
  /** Workbook "modified" property; advisory, absent for CSV. */
  workbookModifiedAt: string | null;
  /** Server receipt time of the file (trusted). */
  receivedAt: string;
}

export type FreshnessVerdict = { verdict: 'FRESH' } | { verdict: 'STALE' | 'UNPROVEN'; reason: string };

/**
 * GLO-277: may `incoming` replace the offer state last accepted from `lastAccepted`? Upload time alone never proves
 * freshness: an old export uploaded today must not overwrite newer truth, and a newer export uploaded earlier must not
 * be refused. Source times win; when the previous state had one and this row does not, freshness is unproven (review).
 */
export function assessSourceFreshness(incoming: SourceTiming, lastAccepted: SourceTiming | null, shortageObservedAt?: Date | null): FreshnessVerdict {
  if (shortageObservedAt) {
    const observed = incoming.sourceObservedAt ? Date.parse(incoming.sourceObservedAt) : NaN;
    if (!Number.isFinite(observed)) return { verdict: 'UNPROVEN', reason: 'dated_stock_evidence_required_after_po_shortage' };
    if (observed <= shortageObservedAt.getTime()) return { verdict: 'STALE', reason: 'source_time_not_newer_than_po_shortage' };
  }
  if (!lastAccepted) return { verdict: 'FRESH' };
  if (incoming.sourceObservedAt && lastAccepted.sourceObservedAt) {
    return incoming.sourceObservedAt < lastAccepted.sourceObservedAt
      ? { verdict: 'STALE', reason: 'source_time_older_than_last_accepted_offer' } : { verdict: 'FRESH' };
  }
  if (!incoming.sourceObservedAt && lastAccepted.sourceObservedAt) {
    return { verdict: 'UNPROVEN', reason: 'no_source_time_while_last_accepted_offer_had_one' };
  }
  if (incoming.workbookModifiedAt && lastAccepted.workbookModifiedAt && incoming.workbookModifiedAt < lastAccepted.workbookModifiedAt) {
    return { verdict: 'UNPROVEN', reason: 'workbook_modified_before_last_accepted_export' };
  }
  return incoming.receivedAt < lastAccepted.receivedAt
    ? { verdict: 'STALE', reason: 'received_before_last_accepted_import' } : { verdict: 'FRESH' };
}

type TimedJob = { createdAt: Date; sourceMetadata: Prisma.JsonValue | null };
function sourceTiming(job: TimedJob, enrichment: Prisma.JsonValue | null): SourceTiming {
  const meta = (job.sourceMetadata ?? {}) as { receivedAt?: string; workbookModifiedAt?: string | null };
  const input = ((enrichment ?? {}) as { source?: { input?: { sourceObservedAt?: string | null } } }).source?.input;
  return {
    sourceObservedAt: input?.sourceObservedAt ?? null,
    workbookModifiedAt: meta.workbookModifiedAt ?? null,
    receivedAt: meta.receivedAt ?? job.createdAt.toISOString(),
  };
}

type OfferWrite = { itemId: string; skuId: string; cost: number; currency: string; available: boolean; priceOnly: boolean; quantity: number | null };
type ItemPatch = { status: IngestionStatus | null; patch: Record<string, unknown> };
const WRITE_CHUNK = 500;
const chunks = <T>(list: T[]): T[][] =>
  Array.from({ length: Math.ceil(list.length / WRITE_CHUNK) }, (_, i) => list.slice(i * WRITE_CHUNK, (i + 1) * WRITE_CHUNK));

@Injectable()
export class OfferBatchCommitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly sourcingService: SourcingService,
  ) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  /**
   * GLO-280: the candidate admission path applies the batch path's policy — source-time freshness against the row that
   * produced the current offer, currency change, >30% jump and FINANCIAL_HOLD against the effective selling price.
   * Returns the review reasons (empty = safe); an offer already produced by this row is reported as `alreadyApplied`.
   */
  private async candidateOfferReview(
    db: Prisma.TransactionClient,
    item: { id: string; price: Prisma.Decimal; currency: string; enrichment: Prisma.JsonValue | null; job: TimedJob & { supplierId: string } },
    skuId: string,
  ): Promise<{ alreadyApplied: boolean; reasons: string[]; existing: { isAvailable: boolean } | null }> {
    const existing = await db.supplierOffer.findUnique({
      where: { supplierId_skuId: { supplierId: item.job.supplierId, skuId } },
    });
    if (existing?.lastIngestionItemId === item.id) return { alreadyApplied: true, reasons: [], existing };
    const cost = item.price.toNumber();
    const reasons: string[] = [];
    if (existing) {
      const last = existing.lastIngestionItemId ? await db.ingestionItem.findUnique({
        where: { id: existing.lastIngestionItemId },
        select: { enrichment: true, job: { select: { createdAt: true, sourceMetadata: true } } },
      }) : null;
      const lastTiming = last ? sourceTiming(last.job, last.enrichment)
        : { sourceObservedAt: null, workbookModifiedAt: null, receivedAt: existing.lastObservedAt.toISOString() };
      const freshness = assessSourceFreshness(sourceTiming(item.job, item.enrichment), lastTiming, existing.shortageObservedAt);
      if (freshness.verdict !== 'FRESH') reasons.push(freshness.reason);
      if (existing.currency !== item.currency) reasons.push('currency_change_requires_review');
      const before = existing.costPrice.toNumber();
      if (before > 0 && Math.abs((cost - before) / before) > 0.3) {
        reasons.push(`large_price_jump: ${(((cost - before) / before) * 100).toFixed(1)}% exceeds 30% anomaly threshold`);
      }
    }
    const now = new Date();
    const approvedPrice = await db.sellingPrice.findFirst({
      where: { skuId, isActive: true, validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
      orderBy: { validFrom: 'desc' },
    });
    if (approvedPrice?.currency === item.currency && cost > approvedPrice.amount.toNumber()) {
      reasons.push(`financial_hold: purchase cost ${cost} exceeds approved selling price ${approvedPrice.amount.toNumber()}`);
    }
    return { alreadyApplied: false, reasons, existing };
  }

  /** The candidate admission path uses the same cost, stock, freshness and anomaly policy as batch commit. */
  async commitCandidateOffer(itemId: string, skuId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const item = await tx.ingestionItem.findUnique({ where: { id: itemId }, include: { job: true } });
      if (!item || item.status !== IngestionStatus.approved) {
        throw new ConflictException('Only an approved candidate can commit a supplier offer');
      }
      if (item.priceType !== IngestionPriceType.PURCHASE_COST || item.price.toNumber() <= 0) {
        throw new BadRequestException('An explicit positive PURCHASE_COST is required');
      }
      if (item.reportedQuantity !== null && item.reportedQuantity < 0) {
        throw new BadRequestException('Reported quantity cannot be negative');
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commit:supplier:${item.job.supplierId}`}))`;
      const review = await this.candidateOfferReview(tx, item, skuId);
      if (review.alreadyApplied) return;
      if (review.reasons.length) {
        throw new ConflictException(`Supplier offer requires review: ${review.reasons.join('; ')}`);
      }
      const { existing } = review;
      const cost = item.price.toNumber();
      const availability = item.reportedQuantity === null
        ? (existing?.isAvailable ?? false)
        : item.reportedQuantity > 0;
      await tx.supplierOffer.upsert({
        where: { supplierId_skuId: { supplierId: item.job.supplierId, skuId } },
        create: { supplierId: item.job.supplierId, skuId, costPrice: cost, currency: item.currency,
          ...(item.reportedQuantity !== null ? { availableQuantity: item.reportedQuantity, quantityUpdatedAt: new Date() } : {}),
          lastIngestionItemId: item.id,
          isAvailable: availability, lastObservedAt: new Date() },
        update: { costPrice: cost, currency: item.currency, isAvailable: availability,
          ...(item.reportedQuantity !== null ? { availableQuantity: item.reportedQuantity, quantityUpdatedAt: new Date() } : {}),
          lastIngestionItemId: item.id, lastObservedAt: new Date() },
      });
    }, { timeout: 30000, maxWait: 10000 });
  }

  /** Creates/updates this supplier's offers in set-based statements; the caller holds the supplier commit lock. */
  private async applyOfferWrites(tx: Prisma.TransactionClient, supplierId: string, writes: OfferWrite[]): Promise<void> {
    if (!writes.length) return;
    const existing = await tx.supplierOffer.findMany({
      where: { supplierId, skuId: { in: writes.map(w => w.skuId) } }, select: { id: true, skuId: true },
    });
    const idBySku = new Map(existing.map(o => [o.skuId, o.id]));
    const now = new Date();
    const creates = writes.filter(w => !idBySku.has(w.skuId));
    if (creates.length) {
      await tx.supplierOffer.createMany({ data: creates.map(w => ({ supplierId, skuId: w.skuId, costPrice: w.cost,
        ...(!w.priceOnly ? { availableQuantity: w.quantity, quantityUpdatedAt: now } : {}),
        currency: w.currency, isAvailable: w.available, lastObservedAt: now, lastIngestionItemId: w.itemId })) });
    }
    const at = Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    for (const chunk of chunks(writes.filter(w => idBySku.has(w.skuId)))) {
      const values = Prisma.join(chunk.map(w => Prisma.sql`(${idBySku.get(w.skuId)}::uuid, ${w.cost}::numeric,
        ${w.currency}::varchar, ${w.available}::boolean, ${w.priceOnly}::boolean, ${w.itemId}::uuid, ${w.quantity}::integer)`));
      // A price-only row never changes availability.
      await tx.$executeRaw`UPDATE "sourcing"."supplier_offers" AS o SET "cost_price" = v.cost, "currency" = v.currency,
        "is_available" = CASE WHEN v.price_only THEN o."is_available" ELSE v.available END,
        "available_quantity" = CASE WHEN v.price_only THEN o."available_quantity" ELSE v.quantity END,
        "quantity_updated_at" = CASE WHEN v.price_only THEN o."quantity_updated_at" ELSE ${at} END,
        "last_observed_at" = ${at}, "last_ingestion_item_id" = v.item_id, "updated_at" = ${at}
        FROM (VALUES ${values}) AS v(id, cost, currency, available, price_only, item_id, quantity) WHERE o."id" = v.id`;
    }
  }

  /** Sets item status (when given) and merges only the given enrichment keys, leaving concurrently written keys intact. */
  private async applyItemPatches(tx: Prisma.TransactionClient, patches: Array<[string, ItemPatch]>): Promise<void> {
    const at = Prisma.sql`(${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    for (const chunk of chunks(patches)) {
      const values = Prisma.join(chunk.map(([id, p]) => Prisma.sql`(${id}::uuid, ${p.status}::text, ${JSON.stringify(p.patch)}::jsonb)`));
      await tx.$executeRaw`UPDATE "ingestion"."ingestion_items" AS i
        SET "status" = COALESCE(v.status::"ingestion"."IngestionStatus", i."status"),
            "enrichment" = COALESCE(i."enrichment", '{}'::jsonb) || v.patch, "updated_at" = ${at}
        FROM (VALUES ${values}) AS v(id, status, patch) WHERE i."id" = v.id`;
    }
  }

  async assertCandidateOfferSafe(itemId: string, skuId: string | null): Promise<void> {
    const item = await this.prisma.ingestionItem.findUnique({ where: { id: itemId }, include: { job: true } });
    if (!item || item.priceType !== IngestionPriceType.PURCHASE_COST || item.price.toNumber() <= 0) {
      throw new BadRequestException('An explicit positive PURCHASE_COST is required');
    }
    if (item.reportedQuantity !== null && item.reportedQuantity < 0) {
      throw new BadRequestException('Reported quantity cannot be negative');
    }
    if (!skuId) return;
    const review = await this.candidateOfferReview(this.prisma, item, skuId);
    if (review.reasons.length) {
      throw new ConflictException(`Supplier offer requires review: ${review.reasons.join('; ')}`);
    }
  }

  /**
   * Computes staged row-level before/after diffs and counters for a job without mutating the database.
   */
  async computeJobDiff(jobId: string): Promise<JobDiffSummary> {
    if (!this.isUuid(jobId)) throw new BadRequestException('Invalid job ID');
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: {
        items: true,
        supplier: true,
      },
    });

    if (!job) throw new NotFoundException('Ingestion job not found');

    const matchedSkuIds = job.items
      .map((i) => i.matchedSkuId)
      .filter((id): id is string => Boolean(id));

    // Live DB snapshot: fetch existing supplier offers for all matched SKUs
    const existingOffers = await this.prisma.supplierOffer.findMany({
      where: {
        supplierId: job.supplierId,
        skuId: { in: matchedSkuIds },
      },
    });
    const offerMap = new Map(existingOffers.map((o) => [o.skuId, o]));

    // Source timing of the rows that produced the current offers (batched; no per-row queries).
    const lastAcceptedItems = await this.prisma.ingestionItem.findMany({
      where: { id: { in: existingOffers.map(o => o.lastIngestionItemId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, enrichment: true, job: { select: { createdAt: true, sourceMetadata: true } } },
    });
    const lastAcceptedTiming = new Map(lastAcceptedItems.map(i => [i.id, sourceTiming(i.job, i.enrichment)]));

    // Currently effective approved selling prices: a verified per-unit cost above it is a FINANCIAL_HOLD (GLO-275/277).
    const now = new Date();
    const sellingPrices = await this.prisma.sellingPrice.findMany({
      where: { skuId: { in: matchedSkuIds }, isActive: true, validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
      orderBy: { validFrom: 'desc' },
    });
    const sellingPriceBySku = new Map<string, (typeof sellingPrices)[number]>();
    for (const price of sellingPrices) if (!sellingPriceBySku.has(price.skuId)) sellingPriceBySku.set(price.skuId, price);

    const rows: RowDiff[] = [];
    const counters = {
      updated: 0,
      created: 0,
      unchanged: 0,
      review: 0,
      skipped: 0,
      error: 0,
      deactivationsPending: 0,
    };

    for (const item of job.items) {
      // Check if item was explicitly rejected
      if (item.status === IngestionStatus.rejected) {
        rows.push({
          itemId: item.id,
          supplierSkuCode: item.supplierSkuCode,
          matchedSkuId: item.matchedSkuId,
          canonicalSkuCode: null,
          productName: item.name,
          action: RowDiffAction.SKIP,
          reasons: ['item_was_rejected_by_operator'],
          before: null,
          after: {
            costPrice: null,
            currency: item.currency,
            isAvailable: null,
          },
          priceChangePercent: null,
          isLargePriceJump: false,
          isRetailOnly: false,
          isPriceOnly: false,
        });
        counters.skipped++;
        continue;
      }

      if (item.priceType === null) {
        rows.push({
          itemId: item.id, supplierSkuCode: item.supplierSkuCode, matchedSkuId: item.matchedSkuId,
          canonicalSkuCode: null, productName: item.name, action: RowDiffAction.REVIEW,
          reasons: ['price_type_requires_explicit_purchase_cost_review'], before: null,
          after: { costPrice: null, currency: item.currency, isAvailable: null },
          priceChangePercent: null, isLargePriceJump: false, isRetailOnly: false,
          isPriceOnly: item.reportedQuantity === null,
        });
        counters.review++;
        continue;
      }

      // Check if item price is invalid (<= 0)
      if (item.price === null || item.price.toNumber() <= 0) {
        rows.push({
          itemId: item.id,
          supplierSkuCode: item.supplierSkuCode,
          matchedSkuId: item.matchedSkuId,
          canonicalSkuCode: null,
          productName: item.name,
          action: RowDiffAction.ERROR,
          reasons: ['invalid_price: price must be greater than zero'],
          before: null,
          after: {
            costPrice: null,
            currency: item.currency,
            isAvailable: null,
          },
          priceChangePercent: null,
          isLargePriceJump: false,
          isRetailOnly: false,
          isPriceOnly: false,
        });
        counters.error++;
        continue;
      }

      if (item.reportedQuantity !== null && item.reportedQuantity < 0) {
        rows.push({
          itemId: item.id, supplierSkuCode: item.supplierSkuCode, matchedSkuId: item.matchedSkuId,
          canonicalSkuCode: null, productName: item.name, action: RowDiffAction.ERROR,
          reasons: ['invalid_negative_reported_quantity'], before: null,
          after: { costPrice: null, currency: item.currency, isAvailable: null },
          priceChangePercent: null, isLargePriceJump: false,
          isRetailOnly: item.priceType === IngestionPriceType.RETAIL_REFERENCE, isPriceOnly: false,
        });
        counters.error++;
        continue;
      }

      if (!item.matchedSkuId) {
        rows.push({
          itemId: item.id,
          supplierSkuCode: item.supplierSkuCode,
          matchedSkuId: null,
          canonicalSkuCode: null,
          productName: item.name,
          action: RowDiffAction.SKIP,
          reasons: ['unmatched_candidate_requires_catalog_admission'],
          before: null,
          after: {
            costPrice: null,
            currency: item.currency,
            isAvailable: null,
          },
          priceChangePercent: null,
          isLargePriceJump: false,
          isRetailOnly: item.priceType === IngestionPriceType.RETAIL_REFERENCE,
          isPriceOnly: item.reportedQuantity === null,
        });
        counters.skipped++;
        continue;
      }

      const existingOffer = offerMap.get(item.matchedSkuId);
      const isRetailOnly = item.priceType === IngestionPriceType.RETAIL_REFERENCE;
      const isPriceOnly = item.reportedQuantity === null;

      const before = existingOffer
        ? {
            costPrice: existingOffer.costPrice.toNumber(),
            currency: existingOffer.currency,
            isAvailable: existingOffer.isAvailable,
            lastObservedAt: existingOffer.lastObservedAt,
          }
        : null;

      // Determine proposed after state
      let afterCost: number | null;
      if (isRetailOnly) {
        // Retail-only file does not mutate wholesale cost price
        afterCost = before ? before.costPrice : null;
      } else {
        afterCost = item.price.toNumber();
      }

      let afterAvailability: boolean;
      if (item.reportedQuantity !== null) {
        // Zeros apply strictly
        afterAvailability = item.reportedQuantity > 0;
      } else {
        // Price-only leaves stock/availability intact
        afterAvailability = before ? before.isAvailable : false;
      }

      let priceChangePercent: number | null = null;
      let isLargePriceJump = false;
      const reasons: string[] = [];
      const currencyChange = Boolean(before && before.currency !== item.currency);
      if (currencyChange) reasons.push('currency_change_requires_review');

      if (before && afterCost !== null && before.costPrice !== null && before.costPrice > 0) {
        priceChangePercent = ((afterCost - before.costPrice) / before.costPrice) * 100;
        if (Math.abs(priceChangePercent) > 30) {
          isLargePriceJump = true;
          reasons.push(`large_price_jump: ${priceChangePercent.toFixed(1)}% exceeds 30% anomaly threshold`);
        }
      }

      if (isRetailOnly) {
        reasons.push('retail_reference_price_does_not_mutate_cost');
      }

      // Freshness against the source of the currently accepted offer (re-committing the same row is idempotent).
      const lastTiming = existingOffer && existingOffer.lastIngestionItemId !== item.id
        ? (existingOffer.lastIngestionItemId && lastAcceptedTiming.get(existingOffer.lastIngestionItemId)) ||
          { sourceObservedAt: null, workbookModifiedAt: null, receivedAt: existingOffer.lastObservedAt.toISOString() }
        : null;
      const freshness = assessSourceFreshness(sourceTiming(job, item.enrichment), lastTiming, existingOffer?.shortageObservedAt);
      if (freshness.verdict === 'STALE') {
        rows.push({
          itemId: item.id, supplierSkuCode: item.supplierSkuCode, matchedSkuId: item.matchedSkuId, canonicalSkuCode: null,
          productName: item.name, action: RowDiffAction.SKIP, reasons: [freshness.reason], before,
          after: { costPrice: afterCost, currency: item.currency, isAvailable: afterAvailability },
          priceChangePercent, isLargePriceJump, isRetailOnly, isPriceOnly,
        });
        counters.skipped++;
        continue;
      }
      if (freshness.verdict === 'UNPROVEN') reasons.push(freshness.reason);

      const approvedPrice = sellingPriceBySku.get(item.matchedSkuId);
      const financialHold = !isRetailOnly && afterCost !== null && approvedPrice?.currency === item.currency &&
        afterCost > approvedPrice.amount.toNumber();
      if (financialHold) {
        reasons.push(`financial_hold: purchase cost ${afterCost} exceeds approved selling price ${approvedPrice!.amount.toNumber()}`);
      }

      // Classify action
      let action: RowDiffAction;
      if (isLargePriceJump || currencyChange || financialHold || freshness.verdict === 'UNPROVEN') {
        action = RowDiffAction.REVIEW;
        counters.review++;
      } else if (isRetailOnly && !existingOffer) {
        action = RowDiffAction.SKIP;
        counters.skipped++;
      } else if (!existingOffer) {
        action = RowDiffAction.CREATE;
        reasons.push('new_supplier_offer');
        counters.created++;
      } else {
        const isCostIdentical = before && afterCost === before.costPrice && item.currency === before.currency;
        const isAvailabilityIdentical = before && afterAvailability === before.isAvailable;

        if (isCostIdentical && isAvailabilityIdentical) {
          action = RowDiffAction.UNCHANGED;
          reasons.push('identical_cost_and_availability');
          counters.unchanged++;
        } else {
          action = RowDiffAction.UPDATE;
          if (!isCostIdentical) reasons.push('cost_price_changed');
          if (!isAvailabilityIdentical) reasons.push('availability_changed');
          counters.updated++;
        }
      }

      rows.push({
        itemId: item.id,
        supplierSkuCode: item.supplierSkuCode,
        matchedSkuId: item.matchedSkuId,
        canonicalSkuCode: null,
        productName: item.name,
        action,
        reasons,
        before,
        after: {
          costPrice: afterCost,
          currency: item.currency,
          isAvailable: afterAvailability,
        },
        priceChangePercent,
        isLargePriceJump,
        isRetailOnly,
        isPriceOnly,
      });
    }

    // Evaluate FULL_SNAPSHOT deactivations & anomaly threshold
    let deactivationCandidates: Array<{
      skuId: string;
      skuCode: string;
      productName: string;
      currentCost: number;
      isAvailable: boolean;
    }> = [];
    let requiresDeactivationApproval = false;

    // Price-only files have NO inventory signal and must NEVER deactivate offers
    const isJobPriceOnly = job.items.length > 0 && job.items.every((i) => i.reportedQuantity === null);

    if (job.mode === IngestionImportMode.FULL_SNAPSHOT && !isJobPriceOnly) {
      const activeSupplierOffers = await this.prisma.supplierOffer.findMany({
        where: {
          supplierId: job.supplierId,
          isAvailable: true,
          skuId: { notIn: matchedSkuIds },
        },
        include: {
          supplier: true,
        },
      });

      const totalActiveOffersCount = await this.prisma.supplierOffer.count({
        where: { supplierId: job.supplierId, isAvailable: true },
      });

      if (activeSupplierOffers.length > 0) {
        counters.deactivationsPending = activeSupplierOffers.length;
        // Show the reviewer which products would be switched off, not an opaque id fragment.
        const candidateSkus = await this.prisma.sku.findMany({
          where: { id: { in: activeSupplierOffers.map((o) => o.skuId) } },
          select: { id: true, code: true, variantName: true, product: { select: { name: true } } },
        });
        const skuById = new Map(candidateSkus.map((s) => [s.id, s]));
        deactivationCandidates = activeSupplierOffers.map((o) => {
          const sku = skuById.get(o.skuId);
          return {
            skuId: o.skuId,
            skuCode: sku?.code ?? o.skuId.slice(0, 8),
            productName: sku
              ? (sku.variantName && sku.variantName !== 'Default' ? `${sku.product.name} — ${sku.variantName}` : sku.product.name)
              : `Canonical SKU (${o.skuId.slice(0, 8)})`,
            currentCost: o.costPrice.toNumber(),
            isAvailable: o.isAvailable,
          };
        });

        // In FULL_SNAPSHOT, ALL missing offers require explicit deactivation approval
        // A 20% missing-offer threshold is an anomaly detector, not permission for automatic deactivation
        requiresDeactivationApproval = true;
      }
    }

    return {
      jobId: job.id,
      supplierId: job.supplierId,
      mode: job.mode,
      totalRows: job.items.length,
      sourceRows: this.summarizeSourceRows(job.rowOutcomes, job.items.length),
      counters,
      rows,
      deactivationCandidates,
      requiresDeactivationApproval,
    };
  }

  /**
   * Intake records an outcome for every file row, but only admitted rows become items. Without this summary the
   * supplier sees "0 errors" for a file whose rows were all rejected.
   */
  private summarizeSourceRows(rowOutcomes: Prisma.JsonValue | null, admittedItems: number): SourceRowSummary | undefined {
    if (!Array.isArray(rowOutcomes)) return undefined;
    const outcomes = (rowOutcomes as Array<Record<string, unknown>>).map((o) => ({
      sourceRow: Number(o.sourceRow),
      supplierSku: String(o.supplierSku ?? ''),
      outcome: String(o.outcome ?? ''),
      reason: typeof o.reason === 'string' ? o.reason : null,
    }));
    const notAdmitted = outcomes
      .filter((o) => !['IMPORTED', 'IMPORTED_MANUAL'].includes(o.outcome))
      .sort((a, b) => a.sourceRow - b.sourceRow);
    const count = (outcome: string) => notAdmitted.filter((o) => o.outcome === outcome).length;
    return {
      total: outcomes.length,
      admitted: admittedItems,
      invalid: count('INVALID'),
      duplicate: count('DUPLICATE'),
      outOfScope: count('OUT_OF_SCOPE'),
      notAdmitted,
    };
  }

  /**
   * Atomically commits supplier offer updates for a job with per-supplier transactional isolation.
   */
  async commitJobOffers(jobId: string, options: CommitJobOptions = {}): Promise<CommitJobResult> {
    if (!this.isUuid(jobId)) throw new BadRequestException('Invalid job ID');

    return this.prisma.$transaction(
      async (tx) => {
        const owner = await tx.ingestionJob.findUnique({ where: { id: jobId }, select: { supplierId: true } });
        if (!owner) throw new NotFoundException('Ingestion job not found');

        // Advisory transaction lock per supplier to prevent concurrent/interleaved commits. The job is read only
        // AFTER the lock: a concurrent commit that finished while we waited must be seen (exactly-once, GLO-277).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commit:supplier:${owner.supplierId}`}))`;
        const job = await tx.ingestionJob.findUniqueOrThrow({
          where: { id: jobId },
          include: { items: true },
        });

        // Idempotency: if job is already published, return safe result without double-applying
        if (job.status === IngestionStatus.published) {
          const priorOutcomes = job.items.map(i => (i.enrichment as any)?.offerCommit as ItemCommitOutcome | undefined);
          return {
            jobId: job.id,
            supplierId: job.supplierId,
            status: 'ALREADY_PUBLISHED',
            committedCount: 0,
            unchangedCount: priorOutcomes.filter(outcome => outcome?.status === 'COMMITTED').length,
            heldForReviewCount: 0,
            skippedCount: 0,
            errorCount: 0,
            deactivatedCount: 0,
            itemOutcomes: job.items.map((i, index) => priorOutcomes[index] ?? ({
              itemId: i.id,
              supplierSkuCode: i.supplierSkuCode,
              skuId: i.matchedSkuId,
              action: RowDiffAction.UNCHANGED,
              status: 'COMMITTED',
              reason: 'idempotent_reapplication_already_published',
            })),
          };
        }

        const diff = await this.computeJobDiff(jobId);
        const itemOutcomes: ItemCommitOutcome[] = [];

        let committedCount = 0;
        let unchangedCount = 0;
        let heldForReviewCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        // GLO-281: writes are collected and applied in set-based statements below, so a 1,000-row file commits in a
        // handful of round trips instead of ~5 per row (which exceeded the transaction budget on a remote database).
        const offerWrites = new Map<string, OfferWrite>();
        const itemPatches = new Map<string, ItemPatch>();
        const itemsById = new Map(job.items.map(i => [i.id, i]));

        for (const row of diff.rows) {
          const item = itemsById.get(row.itemId);
          if (!item) continue;
          if (item.status === IngestionStatus.published) {
            unchangedCount++;
            itemOutcomes.push((item.enrichment as any)?.offerCommit ?? {
              itemId: item.id, supplierSkuCode: item.supplierSkuCode, skuId: item.matchedSkuId,
              action: RowDiffAction.UNCHANGED, status: 'COMMITTED', reason: 'already_committed_in_prior_attempt',
            });
            continue;
          }

          // 1. Invalid / error rows
          if (row.action === RowDiffAction.ERROR) {
            errorCount++;
            itemOutcomes.push({
              itemId: item.id,
              supplierSkuCode: item.supplierSkuCode,
              skuId: item.matchedSkuId,
              action: RowDiffAction.ERROR,
              status: 'ERROR',
              reason: row.reasons.join('; '),
            });
            continue;
          }

          // 2. Explicitly skipped rows (e.g. operator rejected, retail reference only, unmatched)
          if (row.action === RowDiffAction.SKIP) {
            skippedCount++;
            itemOutcomes.push({
              itemId: item.id,
              supplierSkuCode: item.supplierSkuCode,
              skuId: item.matchedSkuId,
              action: RowDiffAction.SKIP,
              status: 'SKIPPED',
              reason: row.reasons.join('; '),
            });
            continue;
          }

          // 3. Items flagged for review (large price jump, ambiguous)
          if (row.action === RowDiffAction.REVIEW) {
            heldForReviewCount++;
            itemOutcomes.push({
              itemId: item.id,
              supplierSkuCode: item.supplierSkuCode,
              skuId: item.matchedSkuId,
              action: RowDiffAction.REVIEW,
              status: 'HELD_FOR_REVIEW',
              reason: row.reasons.join('; '),
            });
            itemPatches.set(item.id, { status: IngestionStatus.review_required,
              patch: { diff: { action: row.action, reasons: row.reasons, before: row.before, after: row.after } } });
            continue;
          }

          // 3. Retail reference only items (skipped for cost mutation)
          if (row.isRetailOnly) {
            skippedCount++;
            itemOutcomes.push({
              itemId: item.id,
              supplierSkuCode: item.supplierSkuCode,
              skuId: item.matchedSkuId,
              action: RowDiffAction.SKIP,
              status: 'SKIPPED',
              reason: 'retail_reference_price_does_not_mutate_cost',
            });
            continue;
          }

          // 4. Unmatched items
          if (!item.matchedSkuId) {
            skippedCount++;
            itemOutcomes.push({
              itemId: item.id,
              supplierSkuCode: item.supplierSkuCode,
              skuId: null,
              action: RowDiffAction.SKIP,
              status: 'SKIPPED',
              reason: 'unmatched_item_not_committed_to_offers',
            });
            continue;
          }

          // 5. Staleness was decided in the diff from source times (assessSourceFreshness), under this supplier lock.

          // 6. Apply UPDATE, CREATE, or UNCHANGED
          if (row.action === RowDiffAction.CREATE || row.action === RowDiffAction.UPDATE || row.action === RowDiffAction.UNCHANGED) {
            const skuId = item.matchedSkuId;
            const targetCost = row.after.costPrice ?? item.price.toNumber();
            const targetCurrency = row.after.currency ?? item.currency;
            const targetAvailability = row.after.isAvailable ?? false;

            // Two rows for one SKU: the later row wins, as with row-by-row application.
            offerWrites.delete(skuId);
            offerWrites.set(skuId, { itemId: item.id, skuId, cost: targetCost, currency: targetCurrency,
              available: targetAvailability, priceOnly: row.isPriceOnly, quantity: item.reportedQuantity });

            if (row.action === RowDiffAction.UNCHANGED) {
              unchangedCount++;
            } else {
              committedCount++;
            }

            itemPatches.set(item.id, { status: IngestionStatus.published,
              patch: { diff: { action: row.action, before: row.before, after: row.after } } });

            itemOutcomes.push({
              itemId: item.id,
              supplierSkuCode: item.supplierSkuCode,
              skuId,
              action: row.action,
              status: 'COMMITTED',
              appliedCostPrice: targetCost,
              appliedAvailability: targetAvailability,
            });
          }
        }

        // 7. Handle FULL_SNAPSHOT Deactivations safely
        // Missing offers in a snapshot must NEVER be automatically deactivated during batch commit.
        // A 20% missing-offer threshold is only an anomaly detector, not permission for automatic deactivation.
        // Even with a 1-19% disappearance, deactivations must be explicitly authorized via approveDeactivations.
        let deactivatedCount = 0;
        if (job.mode === IngestionImportMode.FULL_SNAPSHOT && diff.deactivationCandidates.length > 0) {
          for (const cand of diff.deactivationCandidates) {
            itemOutcomes.push({
              itemId: `deact-${cand.skuId}`,
              supplierSkuCode: cand.skuCode,
              skuId: cand.skuId,
              action: RowDiffAction.DEACTIVATE,
              status: 'HELD_FOR_REVIEW',
              reason: 'full_snapshot_missing_offers_require_explicit_deactivation_approval',
            });
          }
        }

        // 8. Update Job Status
        const unresolvedSkip = itemOutcomes.some(outcome => outcome.status === 'SKIPPED' &&
          !/item_was_rejected_by_operator|retail_reference_price_does_not_mutate_cost/.test(outcome.reason ?? ''));
        const newStatus =
          heldForReviewCount > 0 || errorCount > 0 || unresolvedSkip
            ? IngestionStatus.review_required
            : IngestionStatus.published;

        for (const outcome of itemOutcomes) {
          if (!itemsById.has(outcome.itemId)) continue;
          const entry = itemPatches.get(outcome.itemId) ?? { status: null, patch: {} };
          entry.patch.offerCommit = outcome;
          itemPatches.set(outcome.itemId, entry);
        }
        await this.applyOfferWrites(tx, job.supplierId, [...offerWrites.values()]);
        await this.applyItemPatches(tx, [...itemPatches.entries()]);

        await tx.ingestionJob.update({
          where: { id: jobId },
          data: { status: newStatus },
        });

        return {
          jobId: job.id,
          supplierId: job.supplierId,
          status: newStatus,
          committedCount,
          unchangedCount,
          heldForReviewCount,
          skippedCount,
          errorCount,
          deactivatedCount,
          itemOutcomes,
        };
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  /**
   * Approves held FULL_SNAPSHOT deactivations following human anomaly inspection.
   * Enforces Admin authorization, supplier scope, audit evidence and exact reviewed change set.
   */
  async approveDeactivations(
    jobId: string,
    actorId: string,
    options?: ApproveDeactivationsOptions,
  ): Promise<{ deactivatedCount: number; deactivatedSkuIds: string[] }> {
    if (!this.isUuid(jobId)) throw new BadRequestException('Invalid job ID');
    if (!this.isUuid(actorId)) throw new BadRequestException('Invalid actor ID');

    // 1. Admin authorization check
    const reviewer = await this.prisma.customer.findUnique({ where: { id: actorId } });
    if (!reviewer?.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only administrators can approve supplier catalog deactivations');
    }

    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });
    if (!job) throw new NotFoundException('Ingestion job not found');
    if (job.mode !== IngestionImportMode.FULL_SNAPSHOT) {
      throw new BadRequestException('Deactivation approval applies only to FULL_SNAPSHOT import mode');
    }

    // 2. Supplier scope check
    if (options?.supplierId && job.supplierId !== options.supplierId) {
      throw new ForbiddenException('Job does not belong to specified supplier scope');
    }

    // 3. Price-only check: cannot deactivate from price-only file
    const isPriceOnly = job.items.length > 0 && job.items.every((i) => i.reportedQuantity === null);
    if (isPriceOnly) {
      throw new BadRequestException('Cannot deactivate offers from a price-only import');
    }

    // 4. Positive assortment coverage confirmation — always required (fail closed when the caller omits options)
    if (options?.confirmedAssortmentCoverage !== true) {
      throw new BadRequestException('Positive confirmation of complete supplier assortment coverage is required to approve deactivations');
    }
    if (!options.approvedSkuIds?.length || new Set(options.approvedSkuIds).size !== options.approvedSkuIds.length) {
      throw new BadRequestException('An exact reviewed SKU deactivation change set is required');
    }
    if (job.status !== IngestionStatus.published || job.items.some(item =>
      item.status !== IngestionStatus.published && item.status !== IngestionStatus.rejected)) {
      throw new ConflictException('Snapshot offer commit must complete before deactivation approval');
    }
    const sourceOutcomes = Array.isArray(job.rowOutcomes) ? job.rowOutcomes as Array<{ outcome?: string }> : [];
    if (sourceOutcomes.some(outcome => !['IMPORTED', 'IMPORTED_MANUAL', 'OUT_OF_SCOPE'].includes(outcome.outcome ?? ''))) {
      throw new ConflictException('Snapshot has unresolved source rows; deactivation is unsafe');
    }

    const matchedSkuIds = job.items
      .map((i) => i.matchedSkuId)
      .filter((id): id is string => Boolean(id));

    const missingOffers = await this.prisma.supplierOffer.findMany({
      where: {
        supplierId: job.supplierId,
        skuId: { notIn: matchedSkuIds },
        isAvailable: true,
      },
      select: { skuId: true },
    });

    const candidateSkuIds = missingOffers.map((o) => o.skuId);
    let targetSkuIds: string[];

    if (options?.approvedSkuIds && options.approvedSkuIds.length > 0) {
      const candidateSet = new Set(candidateSkuIds);
      if (options.approvedSkuIds.some(id => !candidateSet.has(id))) {
        throw new ConflictException('Reviewed deactivation change set no longer matches active missing offers');
      }
      targetSkuIds = options.approvedSkuIds;
    } else {
      targetSkuIds = candidateSkuIds;
    }

    if (targetSkuIds.length === 0) {
      return { deactivatedCount: 0, deactivatedSkuIds: [] };
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commit:supplier:${job.supplierId}`}))`;
      const current = await tx.ingestionJob.findUniqueOrThrow({ where: { id: job.id }, include: { items: true } });
      if (current.status !== IngestionStatus.published || current.items.some(item =>
        item.status !== IngestionStatus.published && item.status !== IngestionStatus.rejected)) {
        throw new ConflictException('Snapshot state changed during deactivation review');
      }
      const stillMissing = await tx.supplierOffer.findMany({ where: {
        supplierId: job.supplierId, skuId: { in: targetSkuIds, notIn: current.items
          .map(item => item.matchedSkuId).filter((id): id is string => Boolean(id)) }, isAvailable: true,
      }, select: { skuId: true } });
      if (stillMissing.length !== targetSkuIds.length) {
        throw new ConflictException('Reviewed deactivation change set changed before commit');
      }
      const result = await tx.supplierOffer.updateMany({
        where: {
          supplierId: job.supplierId,
          skuId: { in: targetSkuIds },
          isAvailable: true,
        },
        data: { isAvailable: false },
      });

      // 5. Audit evidence trail in NotificationOutbox
      await tx.notificationOutbox.create({
        data: {
          eventType: 'ingestion.offers_deactivated',
          aggregateId: job.id,
          aggregateType: 'IngestionJob',
          payload: {
            jobId: job.id,
            supplierId: job.supplierId,
            approvedBy: actorId,
            deactivatedSkuIds: targetSkuIds,
            deactivatedCount: result.count,
            timestamp: new Date().toISOString(),
          },
          deduplicationKey: `deactivation:${job.id}:${Date.now()}`,
        },
      });

      return { deactivatedCount: result.count, deactivatedSkuIds: targetSkuIds };
    });
  }
}

