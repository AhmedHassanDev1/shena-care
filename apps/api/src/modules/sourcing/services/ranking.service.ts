import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SupplierOfferDetail } from './sourcing.service';

export interface RankedOffer extends SupplierOfferDetail {
  score: number;
  reasonCodes: string[];
}

export interface RankingResult {
  skuId: string;
  requiredQuantity: number;
  rankedOffers: RankedOffer[];
  decisionLogId: string;
}

@Injectable()
export class RankingService {
  private readonly STALE_THRESHOLD_DAYS = 7;

  constructor(private readonly prisma: PrismaService) {}

  async rankOffersForSku(skuId: string, quantity: number): Promise<RankingResult> {
    const rawOffers = await this.prisma.supplierOffer.findMany({
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

    const eligibleOffers: RankedOffer[] = [];
    const now = new Date();

    for (const offer of rawOffers) {
      const reasonCodes: string[] = [];
      let isEligible = true;

      // Hard filters
      if (!offer.isAvailable) {
        isEligible = false;
        reasonCodes.push('OUT_OF_STOCK');
      }

      const daysSinceObserved = (now.getTime() - offer.lastObservedAt.getTime()) / (1000 * 3600 * 24);
      if (daysSinceObserved > this.STALE_THRESHOLD_DAYS) {
        isEligible = false;
        reasonCodes.push('STALE_OFFER');
      }

      if (!isEligible) {
        continue;
      }

      // Ranking score calculation (Higher is better)
      // 1. Cost Price (Lower is better, inverted score)
      const cost = offer.costPrice.toNumber();
      const costScore = cost > 0 ? 1000 / cost : 0; 
      
      // 2. Freshness (Newer is better)
      const freshnessScore = Math.max(0, this.STALE_THRESHOLD_DAYS - daysSinceObserved);

      // 3. Reliability (New supplier = neutral prior of 0.5)
      // In v1 we mock this, or calculate based on past PO line statuses
      const reliabilityScore = await this.calculateSupplierReliability(offer.supplierId);

      // Aggregate Score
      // Weights: Cost (60%), Reliability (30%), Freshness (10%)
      const finalScore = (costScore * 0.6) + (reliabilityScore * 100 * 0.3) + (freshnessScore * 10 * 0.1);
      
      reasonCodes.push(`COST_SCORE:${costScore.toFixed(2)}`);
      reasonCodes.push(`RELIABILITY_SCORE:${reliabilityScore.toFixed(2)}`);
      reasonCodes.push(`FRESHNESS_SCORE:${freshnessScore.toFixed(2)}`);

      eligibleOffers.push({
        ...offer,
        costPrice: cost,
        score: finalScore,
        reasonCodes
      });
    }

    // Sort by score descending
    eligibleOffers.sort((a, b) => b.score - a.score);

    const decisionLogId = await this.auditRankingDecision(skuId, quantity, eligibleOffers);

    return {
      skuId,
      requiredQuantity: quantity,
      rankedOffers: eligibleOffers,
      decisionLogId
    };
  }

  private async calculateSupplierReliability(supplierId: string): Promise<number> {
    // Look at past PO lines for this supplier
    const totalLines = await this.prisma.purchaseOrderLine.count({
      where: {
        purchaseOrder: { supplierId }
      }
    });

    if (totalLines === 0) {
      return 0.5; // Neutral prior for new suppliers
    }

    const fullConfirmed = await this.prisma.purchaseOrderLine.count({
      where: {
        purchaseOrder: { supplierId },
        status: 'confirmed_full'
      }
    });

    const unavailable = await this.prisma.purchaseOrderLine.count({
      where: {
        purchaseOrder: { supplierId },
        status: 'unavailable'
      }
    });

    // Simple ratio: (Full + 0.5*Partial - Unavailable) / Total
    // With anti-gaming penalty for frequent unavailability (price baiting proxy)
    const baseScore = fullConfirmed / totalLines;
    const penalty = (unavailable / totalLines) * 0.5;
    
    return Math.max(0, Math.min(1, baseScore - penalty));
  }

  private async auditRankingDecision(skuId: string, quantity: number, rankedOffers: RankedOffer[]): Promise<string> {
    // In a real app this would write to a specialized audit log or timeseries DB
    // For MVP, we just return a generated ID representing the snapshot
    const uuid = crypto.randomUUID();
    // this.prisma.rankingAuditLog.create(...) 
    return uuid;
  }
}
