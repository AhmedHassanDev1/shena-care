import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CorrectPurchaseCostDto, PurchaseCostDto, RecordPurchaseCostDto } from '../dto/buy-list.dto';

type Tx = Prisma.TransactionClient;
const EVIDENCE_PREFIX = 'buylist:';
const keyOf = (evidenceRef: string) => evidenceRef.slice(EVIDENCE_PREFIX.length);

export interface BatchCostView { acquireKey: string; listUnitPrice: string; discountPerUnit: string; finalUnitCost: string; version: number; recordedAt: Date }
export interface OrderItemPurchaseCost {
  /** Units bought for the item (confirmed Buy List allocations). */
  units: number;
  /** Of those, units whose batch has a recorded cost. */
  costedUnits: number;
  /** Exact total of the costed units. */
  cost: Prisma.Decimal;
}

/**
 * Actual acquisition cost of internal Buy List purchases. Hub staff record, per physical purchase (a batch = one Buy List count), the
 * quoted list price, the discount they obtained and therefore the final unit cost. Every order line that count covered inherits it.
 * A purchase with no recorded cost stays pending: nothing here estimates a cost from a retail price or an earlier purchase.
 */
@Injectable()
export class PurchaseCostService {
  constructor(private readonly prisma: PrismaService) {}

  /** final = list - discount, in exact decimals; the discount can never reach or exceed the list price. */
  static finalUnitCost(cost: PurchaseCostDto) {
    const list = new Prisma.Decimal(cost.listUnitPrice);
    const discount = new Prisma.Decimal(cost.discountPerUnit ?? 0);
    const final = list.minus(discount);
    if (list.lte(0) || discount.isNegative() || final.lte(0)) {
      throw new BadRequestException({ code: 'INVALID_PURCHASE_COST', message: 'The discount must be lower than the list price, and the final unit cost must be above zero' });
    }
    return { list, discount, final };
  }

  /** Creates the batch inside the caller's transaction (used by the Buy List count itself). */
  async createInTx(tx: Tx, input: { acquireKey: string; skuId: string; quantity: number; cost: PurchaseCostDto; actorId: string }) {
    const { list, discount, final } = PurchaseCostService.finalUnitCost(input.cost);
    return tx.purchaseCostBatch.create({ data: {
      acquireKey: input.acquireKey, skuId: input.skuId, quantity: input.quantity,
      listUnitPrice: list, discountPerUnit: discount, finalUnitCost: final, recordedBy: input.actorId,
    } });
  }

  private async countAllocations(db: Tx | PrismaService, acquireKey: string) {
    const rows = await db.sourceAllocation.findMany({
      where: { evidenceRef: `${EVIDENCE_PREFIX}${acquireKey}`, confirmedQuantity: { gt: 0 } },
      include: { requirement: { select: { skuId: true } } },
    });
    if (!rows.length) throw new NotFoundException({ code: 'PURCHASE_NOT_FOUND', message: 'No Buy List purchase has this key' });
    return { skuId: rows[0].requirement.skuId, quantity: rows.reduce((sum, row) => sum + row.confirmedQuantity, 0) };
  }

  private present(row: { acquireKey: string; listUnitPrice: Prisma.Decimal; discountPerUnit: Prisma.Decimal; finalUnitCost: Prisma.Decimal; version: number; recordedAt: Date }): BatchCostView {
    return { acquireKey: row.acquireKey, listUnitPrice: row.listUnitPrice.toFixed(2), discountPerUnit: row.discountPerUnit.toFixed(2), finalUnitCost: row.finalUnitCost.toFixed(2), version: row.version, recordedAt: row.recordedAt };
  }

  /** Records the cost of a purchase made earlier. The same values again replay; different values need a correction. */
  async record(dto: RecordPurchaseCostDto, actorId: string) {
    const { skuId, quantity } = await this.countAllocations(this.prisma, dto.acquireKey);
    const { list, discount } = PurchaseCostService.finalUnitCost(dto);
    const existing = await this.prisma.purchaseCostBatch.findUnique({ where: { acquireKey: dto.acquireKey } });
    if (existing) {
      if (existing.listUnitPrice.equals(list) && existing.discountPerUnit.equals(discount)) return { replayed: true, cost: this.present(existing) };
      throw new ConflictException({ code: 'COST_ALREADY_RECORDED', message: 'This purchase already has a recorded cost; correct it with a reason instead', version: existing.version });
    }
    try {
      const batch = await this.prisma.$transaction(tx => this.createInTx(tx, { acquireKey: dto.acquireKey, skuId, quantity, cost: dto, actorId }));
      return { replayed: false, cost: this.present(batch) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'COST_ALREADY_RECORDED', message: 'This purchase already has a recorded cost; correct it with a reason instead' });
      }
      throw error;
    }
  }

  /** Corrects a recorded cost. The previous values stay in the batch history; closed periods keep their frozen figures. */
  async correct(dto: CorrectPurchaseCostDto, actorId: string) {
    const { list, discount, final } = PurchaseCostService.finalUnitCost(dto);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sourcing.purchase_cost_batches WHERE acquire_key = ${dto.acquireKey}::uuid FOR UPDATE`;
      const batch = await tx.purchaseCostBatch.findUnique({ where: { acquireKey: dto.acquireKey } });
      if (!batch) throw new NotFoundException({ code: 'COST_NOT_RECORDED', message: 'This purchase has no recorded cost yet' });
      if (batch.version !== dto.expectedVersion) throw new ConflictException({ code: 'COST_STALE', message: 'This cost changed; reload it before correcting', currentVersion: batch.version });
      const history = Array.isArray(batch.history) ? batch.history : [];
      const updated = await tx.purchaseCostBatch.update({ where: { id: batch.id }, data: {
        listUnitPrice: list, discountPerUnit: discount, finalUnitCost: final, version: { increment: 1 },
        history: [...history, {
          version: batch.version, listUnitPrice: batch.listUnitPrice.toFixed(2), discountPerUnit: batch.discountPerUnit.toFixed(2), finalUnitCost: batch.finalUnitCost.toFixed(2),
          correctedBy: actorId, correctedAt: new Date().toISOString(), reason: dto.reason.trim(),
        }] as Prisma.InputJsonValue,
      } });
      return { cost: this.present(updated) };
    });
  }

  /** Recent Buy List purchases with their cost (or null while pending), newest first. */
  async batches(filter: { pendingOnly?: boolean; take: number }) {
    const allocations = await this.prisma.sourceAllocation.findMany({
      where: { evidenceRef: { startsWith: EVIDENCE_PREFIX }, confirmedQuantity: { gt: 0 } },
      orderBy: { selectedAt: 'desc' }, take: 1000,
      include: { requirement: { select: { skuId: true } } },
    });
    const groups = new Map<string, { acquireKey: string; skuId: string; quantity: number; acquiredAt: Date }>();
    for (const row of allocations) {
      const ref = row.evidenceRef!;
      const group = groups.get(ref);
      if (group) { group.quantity += row.confirmedQuantity; if (row.selectedAt < group.acquiredAt) group.acquiredAt = row.selectedAt; }
      else groups.set(ref, { acquireKey: keyOf(ref), skuId: row.requirement.skuId, quantity: row.confirmedQuantity, acquiredAt: row.selectedAt });
    }
    const costs = await this.prisma.purchaseCostBatch.findMany({ where: { acquireKey: { in: [...groups.values()].map(group => group.acquireKey) } } });
    const costByKey = new Map(costs.map(row => [row.acquireKey, row]));
    const rows = [...groups.values()]
      .map(group => ({ ...group, cost: costByKey.has(group.acquireKey) ? this.present(costByKey.get(group.acquireKey)!) : null }))
      .filter(row => !filter.pendingOnly || row.cost === null)
      .sort((a, b) => b.acquiredAt.getTime() - a.acquiredAt.getTime());
    return { total: rows.length, pending: rows.filter(row => row.cost === null).length, items: rows.slice(0, filter.take) };
  }

  /** Purchase cost of order lines, from the Buy List purchases that covered them. */
  async costForOrderItems(orderItemIds: string[]): Promise<Map<string, OrderItemPurchaseCost>> {
    const result = new Map<string, OrderItemPurchaseCost>();
    for (let offset = 0; offset < orderItemIds.length; offset += 500) {
      const chunk = orderItemIds.slice(offset, offset + 500);
      const allocations = await this.prisma.sourceAllocation.findMany({
        where: { evidenceRef: { startsWith: EVIDENCE_PREFIX }, confirmedQuantity: { gt: 0 }, requirement: { orderItemId: { in: chunk } } },
        include: { requirement: { select: { orderItemId: true } } },
      });
      const batches = await this.prisma.purchaseCostBatch.findMany({ where: { acquireKey: { in: [...new Set(allocations.map(row => keyOf(row.evidenceRef!)))] } } });
      const finalByKey = new Map(batches.map(row => [row.acquireKey, row.finalUnitCost]));
      for (const row of allocations) {
        const entry = result.get(row.requirement.orderItemId) ?? { units: 0, costedUnits: 0, cost: new Prisma.Decimal(0) };
        entry.units += row.confirmedQuantity;
        const unit = finalByKey.get(keyOf(row.evidenceRef!));
        if (unit) { entry.costedUnits += row.confirmedQuantity; entry.cost = entry.cost.plus(unit.mul(row.confirmedQuantity)); }
        result.set(row.requirement.orderItemId, entry);
      }
    }
    return result;
  }
}
