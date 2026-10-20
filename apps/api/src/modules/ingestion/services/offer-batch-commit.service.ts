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
import { IngestionImportMode, IngestionPriceType, IngestionStatus } from '@prisma/client';
import {
  RowDiffAction,
  RowDiff,
  JobDiffSummary,
  CommitJobOptions,
  CommitJobResult,
  ItemCommitOutcome,
  ApproveDeactivationsOptions,
} from '../contracts/offer-batch-commit.contract';

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
        afterAvailability = before ? before.isAvailable : true;
      }

      let priceChangePercent: number | null = null;
      let isLargePriceJump = false;
      const reasons: string[] = [];

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

      // Classify action
      let action: RowDiffAction;
      if (isLargePriceJump) {
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
        deactivationCandidates = activeSupplierOffers.map((o) => ({
          skuId: o.skuId,
          skuCode: o.skuId.slice(0, 8),
          productName: `Canonical SKU (${o.skuId.slice(0, 8)})`,
          currentCost: o.costPrice.toNumber(),
          isAvailable: o.isAvailable,
        }));

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
      counters,
      rows,
      deactivationCandidates,
      requiresDeactivationApproval,
    };
  }

  /**
   * Atomically commits supplier offer updates for a job with per-supplier transactional isolation.
   */
  async commitJobOffers(jobId: string, options: CommitJobOptions = {}): Promise<CommitJobResult> {
    if (!this.isUuid(jobId)) throw new BadRequestException('Invalid job ID');

    return this.prisma.$transaction(
      async (tx) => {
        const job = await tx.ingestionJob.findUnique({
          where: { id: jobId },
          include: { items: true },
        });

        if (!job) throw new NotFoundException('Ingestion job not found');

        // Advisory transaction lock per supplier to prevent concurrent/interleaved commits
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commit:supplier:${job.supplierId}`}))`;

        // Idempotency: if job is already published, return safe result without double-applying
        if (job.status === IngestionStatus.published) {
          return {
            jobId: job.id,
            supplierId: job.supplierId,
            status: 'ALREADY_PUBLISHED',
            committedCount: 0,
            unchangedCount: job.items.length,
            heldForReviewCount: 0,
            skippedCount: 0,
            errorCount: 0,
            deactivatedCount: 0,
            itemOutcomes: job.items.map((i) => ({
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

        for (const row of diff.rows) {
          const item = job.items.find((i) => i.id === row.itemId);
          if (!item) continue;

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
            await tx.ingestionItem.update({
              where: { id: item.id },
              data: {
                status: IngestionStatus.review_required,
                enrichment: {
                  ...((item.enrichment as Record<string, any>) || {}),
                  diff: { action: row.action, reasons: row.reasons, before: row.before, after: row.after },
                } as unknown as import('@prisma/client').Prisma.InputJsonValue,
              },
            });
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

          // 5. Stale update check: protect against out-of-order older feeds
          if (row.before?.lastObservedAt && item.createdAt < row.before.lastObservedAt) {
            skippedCount++;
            itemOutcomes.push({
              itemId: item.id,
              supplierSkuCode: item.supplierSkuCode,
              skuId: item.matchedSkuId,
              action: RowDiffAction.SKIP,
              status: 'SKIPPED',
              reason: 'stale_import_older_than_last_observed_offer',
            });
            continue;
          }

          // 6. Apply UPDATE, CREATE, or UNCHANGED
          if (row.action === RowDiffAction.CREATE || row.action === RowDiffAction.UPDATE || row.action === RowDiffAction.UNCHANGED) {
            const skuId = item.matchedSkuId;
            const targetCost = row.after.costPrice ?? item.price.toNumber();
            const targetCurrency = row.after.currency ?? item.currency;
            const targetAvailability = row.after.isAvailable ?? true;

            const existingOffer = await tx.supplierOffer.findUnique({
              where: {
                supplierId_skuId: {
                  supplierId: job.supplierId,
                  skuId,
                },
              },
            });

            // Re-verify staleness inside transaction against live offer
            if (existingOffer && existingOffer.lastObservedAt && item.createdAt < existingOffer.lastObservedAt) {
              skippedCount++;
              itemOutcomes.push({
                itemId: item.id,
                supplierSkuCode: item.supplierSkuCode,
                skuId: item.matchedSkuId,
                action: RowDiffAction.SKIP,
                status: 'SKIPPED',
                reason: 'stale_import_older_than_last_observed_offer',
              });
              continue;
            }

            if (existingOffer) {
              await tx.supplierOffer.update({
                where: { id: existingOffer.id },
                data: {
                  ...(!row.isRetailOnly && targetCost !== null && { costPrice: targetCost }),
                  ...(targetCurrency && { currency: targetCurrency }),
                  ...(!row.isPriceOnly && { isAvailable: targetAvailability }),
                  lastObservedAt: new Date(),
                },
              });
            } else {
              await tx.supplierOffer.create({
                data: {
                  supplierId: job.supplierId,
                  skuId,
                  costPrice: targetCost,
                  currency: targetCurrency,
                  isAvailable: targetAvailability,
                  lastObservedAt: new Date(),
                },
              });
            }

            if (row.action === RowDiffAction.UNCHANGED) {
              unchangedCount++;
            } else {
              committedCount++;
            }

            await tx.ingestionItem.update({
              where: { id: item.id },
              data: {
                status: IngestionStatus.published,
                enrichment: {
                  ...((item.enrichment as Record<string, any>) || {}),
                  diff: { action: row.action, before: row.before, after: row.after },
                } as unknown as import('@prisma/client').Prisma.InputJsonValue,
              },
            });

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
        const newStatus =
          heldForReviewCount > 0
            ? IngestionStatus.review_required
            : IngestionStatus.published;

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
    options: ApproveDeactivationsOptions = {},
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
    if (options.supplierId && job.supplierId !== options.supplierId) {
      throw new ForbiddenException('Job does not belong to specified supplier scope');
    }

    // 3. Price-only check: cannot deactivate from price-only file
    const isPriceOnly = job.items.length > 0 && job.items.every((i) => i.reportedQuantity === null);
    if (isPriceOnly) {
      throw new BadRequestException('Cannot deactivate offers from a price-only import');
    }

    // 4. Positive assortment coverage confirmation
    if (options.confirmedAssortmentCoverage === false) {
      throw new BadRequestException('Positive confirmation of complete supplier assortment coverage is required to approve deactivations');
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

    if (options.approvedSkuIds && options.approvedSkuIds.length > 0) {
      const candidateSet = new Set(candidateSkuIds);
      targetSkuIds = options.approvedSkuIds.filter((id) => candidateSet.has(id));
      if (targetSkuIds.length === 0) {
        throw new BadRequestException('No matching deactivation candidates found for the specified change set');
      }
    } else {
      targetSkuIds = candidateSkuIds;
    }

    if (targetSkuIds.length === 0) {
      return { deactivatedCount: 0, deactivatedSkuIds: [] };
    }

    return this.prisma.$transaction(async (tx) => {
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

