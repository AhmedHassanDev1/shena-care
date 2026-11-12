import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';

export interface IntakeOfferInput {
  supplierId: string;
  /** Canonical SKU the intake matched; Sourcing never creates or edits catalog records. */
  skuId: string;
  purchasePrice: number;
  consumerPrice: number | null;
  currency: string;
  /** Reported stock; null = not reported (availability unchanged, or available for a new offer). */
  quantity: number | null;
  supplierCode: string | null;
  /** The intake row this statement came from: applying the same row twice changes nothing. */
  sourceRef: string;
}

export type IntakeOfferResult =
  | { result: 'CREATED' | 'CHANGED' | 'UNCHANGED' | 'ALREADY_APPLIED'; offerId: string; before: OfferPrices | null; after: OfferPrices; codeAlias: 'CREATED' | 'KEPT' | 'CONFLICT' | 'NONE' };
interface OfferPrices { purchasePrice: number; consumerPrice: number | null; isAvailable: boolean; availableQuantity: number | null }

const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.005);

/**
 * The only write a supplier price file makes: the supplier's own offer for one canonical SKU (purchase and consumer price, reported stock), plus an append-only
 * price event when the prices change. Idempotent per intake row. A file observes availability; it does not confirm it (confirmation stays a separate step).
 */
@Injectable()
export class OfferIntakeService {
  constructor(private readonly prisma: PrismaService) {}

  async assertActiveSupplier(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, isActive: true } });
    if (!supplier || !supplier.isActive) throw new NotFoundException('Active supplier not found');
    return supplier;
  }

  /** The supplier's own codes already tied to a canonical SKU, lower-cased. */
  async codeAliases(supplierId: string): Promise<Map<string, string>> {
    const aliases = await this.prisma.supplierSkuAlias.findMany({ where: { supplierId }, select: { supplierSkuCode: true, skuId: true } });
    return new Map(aliases.map(alias => [alias.supplierSkuCode.trim().toLowerCase(), alias.skuId]));
  }

  async applyFromIntake(input: IntakeOfferInput): Promise<IntakeOfferResult> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier-offer:${input.supplierId}:${input.skuId}`}))`;
      const existing = await tx.supplierOffer.findUnique({ where: { supplierId_skuId: { supplierId: input.supplierId, skuId: input.skuId } } });
      const before: OfferPrices | null = existing ? { purchasePrice: existing.costPrice.toNumber(), consumerPrice: existing.consumerPrice?.toNumber() ?? null,
        isAvailable: existing.isAvailable, availableQuantity: existing.availableQuantity } : null;
      const codeAlias = await this.recordCode(tx, input);
      const applied = await tx.supplierOfferPriceEvent.findUnique({ where: { sourceRef: input.sourceRef }, select: { offerId: true } });
      if (applied && existing) return { result: 'ALREADY_APPLIED', offerId: existing.id, before, after: before!, codeAlias };

      const isAvailable = input.quantity === null ? (existing?.isAvailable ?? true) : input.quantity > 0;
      const after: OfferPrices = { purchasePrice: input.purchasePrice, consumerPrice: input.consumerPrice ?? before?.consumerPrice ?? null, isAvailable,
        availableQuantity: input.quantity ?? before?.availableQuantity ?? null };
      const now = new Date();
      const data = { costPrice: new Prisma.Decimal(input.purchasePrice), consumerPrice: after.consumerPrice !== null ? new Prisma.Decimal(after.consumerPrice) : null, currency: input.currency,
        isAvailable, lastObservedAt: now, ...(input.quantity !== null && { availableQuantity: input.quantity, quantityUpdatedAt: now }) };
      const offer = existing
        ? await tx.supplierOffer.update({ where: { id: existing.id }, data })
        : await tx.supplierOffer.create({ data: { supplierId: input.supplierId, skuId: input.skuId, ...data } });
      const pricesChanged = !before || !same(before.purchasePrice, after.purchasePrice) || !same(before.consumerPrice, after.consumerPrice);
      const changed = pricesChanged || before!.isAvailable !== after.isAvailable || (input.quantity !== null && before!.availableQuantity !== input.quantity);
      if (pricesChanged) {
        await tx.supplierOfferPriceEvent.create({ data: { offerId: offer.id, supplierId: input.supplierId, skuId: input.skuId, purchasePrice: new Prisma.Decimal(input.purchasePrice),
          consumerPrice: after.consumerPrice !== null ? new Prisma.Decimal(after.consumerPrice) : null, currency: input.currency, sourceType: 'INTAKE_FILE', sourceRef: input.sourceRef, observedAt: now } });
      }
      return { result: !existing ? 'CREATED' : changed ? 'CHANGED' : 'UNCHANGED', offerId: offer.id, before, after, codeAlias };
    }, { timeout: 20000 });
  }

  /** A supplier code seen with a verified match becomes that supplier's alias; a code already tied to another SKU is never re-pointed. */
  private async recordCode(tx: Prisma.TransactionClient, input: IntakeOfferInput): Promise<'CREATED' | 'KEPT' | 'CONFLICT' | 'NONE'> {
    const code = input.supplierCode?.trim();
    if (!code) return 'NONE';
    const existing = await tx.supplierSkuAlias.findUnique({ where: { supplierId_supplierSkuCode: { supplierId: input.supplierId, supplierSkuCode: code } } });
    if (existing) return existing.skuId === input.skuId ? 'KEPT' : 'CONFLICT';
    await tx.supplierSkuAlias.create({ data: { supplierId: input.supplierId, supplierSkuCode: code, skuId: input.skuId } });
    return 'CREATED';
  }

  async priceHistory(offerId: string, take = 20) {
    return this.prisma.supplierOfferPriceEvent.findMany({ where: { offerId }, orderBy: { observedAt: 'desc' }, take });
  }

  /** The best current purchase cost per SKU from active suppliers' available offers (for pricing readiness; never a selling price). */
  async purchaseCosts(skuIds: string[]): Promise<Map<string, { purchasePrice: number; consumerPrice: number | null; supplierCount: number; observedAt: Date }>> {
    const offers = await this.prisma.supplierOffer.findMany({ where: { skuId: { in: skuIds }, isAvailable: true, supplier: { isActive: true } },
      select: { skuId: true, costPrice: true, consumerPrice: true, lastObservedAt: true } });
    const map = new Map<string, { purchasePrice: number; consumerPrice: number | null; supplierCount: number; observedAt: Date }>();
    for (const offer of offers) {
      const current = map.get(offer.skuId);
      const cost = offer.costPrice.toNumber();
      if (!current || cost < current.purchasePrice) {
        map.set(offer.skuId, { purchasePrice: cost, consumerPrice: offer.consumerPrice?.toNumber() ?? null, supplierCount: (current?.supplierCount ?? 0) + 1, observedAt: offer.lastObservedAt });
      } else current.supplierCount++;
    }
    return map;
  }
}
