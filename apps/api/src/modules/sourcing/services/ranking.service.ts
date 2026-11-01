import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SupplierOfferDetail } from './sourcing.service';
import { SOURCING_SIGNAL_MAX_AGE_MS } from './availability-policy';
import { Prisma } from '@prisma/client';
import { RecoveryContext, recoveryExclusions, recoveryPickupLead } from './procurement-policy';

export interface RankedOffer extends SupplierOfferDetail {
  score: number;
  reasonCodes: string[];
}

/** An offer for the SKU that was not eligible for automatic selection, with the reasons (audit/review). */
export interface ExcludedOffer {
  offerId: string;
  supplierId: string;
  reasonCodes: string[];
}

export interface RankingResult {
  skuId: string;
  requiredQuantity: number;
  rankedOffers: RankedOffer[];
  excludedOffers: ExcludedOffer[];
  decisionLogId: string;
}

/** Platform procurement currency: when offers mix currencies (no verified FX), only this group is comparable. */
const PLATFORM_CURRENCY = 'EGP';
/** A cost below this share of the comparable benchmark is held for review, never auto-selected. */
const ANOMALY_LOW_RATIO = 0.5;
/** Above this multiple of the benchmark the offer stays eligible but is flagged (it ranks behind cheaper ones anyway). */
const ANOMALY_HIGH_RATIO = 2;
/** Confirmation reliability below this, with enough history, ranks a supplier behind every reliable one. */
const RELIABILITY_FLOOR = 0.5;
const MIN_RELIABILITY_HISTORY = 5;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * GLO-280 sourcing policy (owner-approved 2026-10-23): first filter to offers that may be auto-selected — exact SKU,
 * active supplier, available, fresh, comparable currency, not a suspiciously cheap outlier — then prefer the lowest
 * comparable procurement cost, ranking low-confirmation-reliability suppliers behind reliable ones; ties go to higher
 * reliability, then the fresher observation. MOQ/pack feasibility and landed cost need the offer-terms migration.
 */
@Injectable()
export class RankingService {
  private readonly STALE_THRESHOLD_DAYS = SOURCING_SIGNAL_MAX_AGE_MS / (24 * 3600 * 1000);

  constructor(private readonly prisma: PrismaService) {}

  async rankOffersForSku(skuId: string, quantity: number, options: {
    tx?: Prisma.TransactionClient; requirementId?: string; attemptedOfferIds?: string[]; recovery?: RecoveryContext;
  } = {}): Promise<RankingResult> {
    const db = options.tx ?? this.prisma;
    const rawOffers = await db.supplierOffer.findMany({
      take: 100, orderBy: { id: 'asc' },
      where: {
        skuId,
        supplier: {
          isActive: true
        }
      },
      include: {
        supplier: true
      }
    });

    if (rawOffers.length === 0) {
      throw new NotFoundException(`No suppliers found for SKU ${skuId}`);
    }

    const excludedOffers: ExcludedOffer[] = [];
    const exclude = (offer: { id: string; supplierId: string }, reasonCodes: string[]) =>
      excludedOffers.push({ offerId: offer.id, supplierId: offer.supplierId, reasonCodes });
    const now = new Date();
    const deferred = new Set<string>();
    const daysSince = (offer: { lastObservedAt: Date }) => (now.getTime() - offer.lastObservedAt.getTime()) / (1000 * 3600 * 24);

    // Hard filters
    let candidates = rawOffers.filter(offer => {
      const reasons: string[] = [];
      if (!offer.isAvailable) reasons.push('OUT_OF_STOCK');
      if (daysSince(offer) > this.STALE_THRESHOLD_DAYS) reasons.push('STALE_OFFER');
      if (offer.costPrice.toNumber() <= 0) reasons.push('INVALID_COST');
      if (options.attemptedOfferIds?.includes(offer.id)) reasons.push('ALREADY_ATTEMPTED');
      if (options.recovery) {
        const eligibility = recoveryExclusions({ ...offer, costPrice: offer.costPrice.toNumber() }, options.recovery);
        if (eligibility.length === 1 && eligibility[0] === 'SUPPLIER_CLOSED') {
          deferred.add(offer.id);
        } else reasons.push(...eligibility);
      }
      if (reasons.length) exclude(offer, reasons);
      return reasons.length === 0;
    });

    // Raw numbers in different currencies are not comparable without a verified rate.
    if (new Set(candidates.map(o => o.currency)).size > 1) {
      for (const offer of candidates.filter(o => o.currency !== PLATFORM_CURRENCY)) exclude(offer, ['CURRENCY_NOT_COMPARABLE']);
      candidates = candidates.filter(o => o.currency === PLATFORM_CURRENCY);
    }

    // Outliers: benchmark = median of all comparable quotes when there are 3+, the other quote when there are 2, none for
    // a single offer (no invented median). An extreme quote never drags the benchmark because the median ignores it.
    const flags = new Map<string, string[]>();
    if (candidates.length > 1) {
      const anomalous = new Set<string>();
      for (const offer of candidates) {
        const cost = offer.costPrice.toNumber();
        const benchmark = median((candidates.length > 2 ? candidates : candidates.filter(o => o.id !== offer.id))
          .map(o => o.costPrice.toNumber()));
        if (cost < benchmark * ANOMALY_LOW_RATIO) anomalous.add(offer.id);
        else if (cost > benchmark * ANOMALY_HIGH_RATIO) flags.set(offer.id, [`PRICE_OUTLIER_HIGH:${benchmark.toFixed(2)}`]);
      }
      for (const offer of candidates.filter(o => anomalous.has(o.id))) exclude(offer, ['PRICE_ANOMALY_REVIEW']);
      candidates = candidates.filter(o => !anomalous.has(o.id));
    }

    const eligibleOffers: RankedOffer[] = [];
    const pickupLeads = new Map<string, ReturnType<typeof recoveryPickupLead>>();
    const reliabilityOf = new Map<string, { reliable: boolean; reliability: number }>();
    for (const offer of candidates) {
      const cost = offer.costPrice.toNumber();
      const { score: reliability, history } = await this.calculateSupplierReliability(offer.supplierId, db);
      const reliable = history < MIN_RELIABILITY_HISTORY || reliability >= RELIABILITY_FLOOR;
      const freshnessScore = Math.max(0, this.STALE_THRESHOLD_DAYS - daysSince(offer));
      const pickupLead = options.recovery ? recoveryPickupLead(offer.supplier.pickupLeadMinutes) : null;
      if (pickupLead) pickupLeads.set(offer.id, pickupLead);
      const reasonCodes = [
        `COST_SCORE:${(cost > 0 ? 1000 / cost : 0).toFixed(2)}`,
        `RELIABILITY_SCORE:${reliability.toFixed(2)}`,
        `FRESHNESS_SCORE:${freshnessScore.toFixed(2)}`,
        ...(reliable ? [] : ['LOW_CONFIRMATION_RELIABILITY']),
        ...(flags.get(offer.id) ?? []),
        ...(deferred.has(offer.id) ? ['DEFER_UNTIL_SUPPLIER_OPENS'] : []),
        ...(pickupLead ? [`PICKUP_LEAD_${pickupLead.source}:${pickupLead.minutes}`,
          `PICKUP_UNCERTAINTY_MINUTES:${pickupLead.uncertaintyMinutes}`, 'DELIVERY_SLA_UNVERIFIED'] : []),
      ];
      reliabilityOf.set(offer.id, { reliable, reliability });
      eligibleOffers.push({ ...offer, costPrice: cost, score: 0, reasonCodes });
    }

    const tier = (o: RankedOffer) => reliabilityOf.get(o.id)!;
    eligibleOffers.sort((a, b) =>
      Number(deferred.has(a.id)) - Number(deferred.has(b.id)) ||
      Number(tier(b).reliable) - Number(tier(a).reliable) ||
      Number(pickupLeads.get(a.id)?.source === 'OPERATIONAL_ESTIMATE') - Number(pickupLeads.get(b.id)?.source === 'OPERATIONAL_ESTIMATE') ||
      a.costPrice - b.costPrice ||
      tier(b).reliability - tier(a).reliability ||
      b.lastObservedAt.getTime() - a.lastObservedAt.getTime() ||
      a.id.localeCompare(b.id));
    const rankedOffers = eligibleOffers.map((offer, index) => ({ ...offer, score: eligibleOffers.length - index }));

    const decision = await db.sourcingDecision.create({ data: { skuId, requiredQuantity: quantity,
      requirementId: options.requirementId,
      rankedOffers: rankedOffers.map(o => ({ offerId: o.id, supplierId: o.supplierId, cost: o.costPrice, reasons: o.reasonCodes,
        ...(options.recovery ? { pickupLead: pickupLeads.get(o.id)! } : {}) })),
      excludedOffers: excludedOffers as unknown as Prisma.InputJsonValue,
    } });

    return {
      skuId,
      requiredQuantity: quantity,
      rankedOffers,
      excludedOffers,
      decisionLogId: decision.id,
    };
  }

  private async calculateSupplierReliability(supplierId: string, db: Prisma.TransactionClient): Promise<{ score: number; history: number }> {
    // Look at past PO lines for this supplier
    const totalLines = await db.purchaseOrderLine.count({
      where: {
        purchaseOrder: { supplierId }
      }
    });

    if (totalLines === 0) {
      return { score: 0.5, history: 0 }; // Neutral prior for new suppliers
    }

    const fullConfirmed = await db.purchaseOrderLine.count({
      where: {
        purchaseOrder: { supplierId },
        status: 'confirmed_full'
      }
    });

    const unavailable = await db.purchaseOrderLine.count({
      where: {
        purchaseOrder: { supplierId },
        status: 'unavailable'
      }
    });

    // Simple ratio: (Full + 0.5*Partial - Unavailable) / Total
    // With anti-gaming penalty for frequent unavailability (price baiting proxy)
    const baseScore = fullConfirmed / totalLines;
    const penalty = (unavailable / totalLines) * 0.5;

    return { score: Math.max(0, Math.min(1, baseScore - penalty)), history: totalLines };
  }

}
