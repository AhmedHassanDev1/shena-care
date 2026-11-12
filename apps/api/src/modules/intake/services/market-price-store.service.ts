import { Injectable } from '@nestjs/common';
import { MarketPriceCheckStatus, Prisma, RetailObservationStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';

export interface ObservationInput {
  skuId: string;
  sourceUrl: string;
  sellerName: string;
  sellerDomain: string;
  priceEgp: number;
  regularPriceEgp: number | null;
  inStock: boolean | null;
  packText: string;
  confidence: number;
  evidenceExcerpt: string | null;
  accepted: boolean;
  rejectReason: string | null;
  collectedBy: string;
}

/** Owner of market price evidence (ingestion.retail_price_observations, ingestion.market_price_checks). Advisory data only; never a cost or a selling price. */
@Injectable()
export class MarketPriceStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async observations(skuId: string, sinceDays: number) {
    return this.prisma.retailPriceObservation.findMany({
      where: { skuId, status: RetailObservationStatus.ACCEPTED, observedAt: { gte: new Date(Date.now() - sinceDays * 86_400_000) } },
      orderBy: { observedAt: 'desc' },
    });
  }

  /** Recent fetches of the same page (accepted or not) are reused instead of fetched again. */
  async recentlyRead(skuId: string, withinHours: number): Promise<Set<string>> {
    const rows = await this.prisma.retailPriceObservation.findMany({ where: { skuId, retrievedAt: { gte: new Date(Date.now() - withinHours * 3_600_000) } }, select: { sourceUrl: true } });
    return new Set(rows.map(row => row.sourceUrl));
  }

  /** One observation per SKU, page, price and day: a re-run the same day never duplicates evidence. */
  async record(input: ObservationInput, at = new Date()) {
    const day = at.toISOString().slice(0, 10);
    const dedupeKey = createHash('sha256').update(`${input.skuId}|${input.sourceUrl}|${input.priceEgp}|${day}`).digest('hex');
    return this.prisma.retailPriceObservation.upsert({
      where: { dedupeKey },
      update: { retrievedAt: at },
      create: { skuId: input.skuId, sourceUrl: input.sourceUrl.slice(0, 1000), sellerName: input.sellerName.slice(0, 120), sellerDomain: input.sellerDomain, observedAt: at, retrievedAt: at,
        priceEgp: new Prisma.Decimal(input.priceEgp), regularPriceEgp: input.regularPriceEgp !== null ? new Prisma.Decimal(input.regularPriceEgp) : null, inStock: input.inStock,
        packText: input.packText.slice(0, 300), confidence: new Prisma.Decimal(input.confidence), evidenceExcerpt: input.evidenceExcerpt?.slice(0, 500) ?? null,
        status: input.accepted ? RetailObservationStatus.ACCEPTED : RetailObservationStatus.REJECTED, rejectReason: input.rejectReason, collectedBy: input.collectedBy, dedupeKey },
    });
  }

  async startCheck(skuId: string, requestedBy: string) {
    return this.prisma.marketPriceCheck.create({ data: { skuId, requestedBy, status: MarketPriceCheckStatus.UNAVAILABLE, coverage: {} } });
  }

  async finishCheck(id: string, data: { status: MarketPriceCheckStatus; reasonCode: string | null; reference: unknown; coverage: unknown; cost: unknown }) {
    return this.prisma.marketPriceCheck.update({ where: { id }, data: { status: data.status, reasonCode: data.reasonCode, reference: data.reference === null ? Prisma.JsonNull : data.reference as Prisma.InputJsonValue,
      coverage: data.coverage as Prisma.InputJsonValue, cost: data.cost as Prisma.InputJsonValue, completedAt: new Date() } });
  }

  async latestCheck(skuId: string) {
    return this.prisma.marketPriceCheck.findFirst({ where: { skuId }, orderBy: { startedAt: 'desc' } });
  }

  async latestChecks(skuIds: string[]) {
    const checks = await this.prisma.marketPriceCheck.findMany({ where: { skuId: { in: skuIds } }, orderBy: { startedAt: 'desc' } });
    const map = new Map<string, (typeof checks)[number]>();
    for (const check of checks) if (!map.has(check.skuId)) map.set(check.skuId, check);
    return map;
  }
}
