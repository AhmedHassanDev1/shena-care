import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { isInternalBuyListMode } from '../config/procurement-batch.config';
import { SupplyPlanService } from './supply-plan.service';
import { PurchaseCostService } from './purchase-cost.service';
import type { PurchaseCostDto } from '../dto/buy-list.dto';

type Tx = Prisma.TransactionClient;

// Advisory lock key space 44090 = per-SKU Buy List counts (44071 = per order, 44072 = per supplier offer); the literal
// sits inside each query because the two-key form needs int arguments.
/** Orders whose goods still have to be obtained: confirmed COD demand, never cancelled/delivered/returned. */
const OPEN_ORDER_STATUSES = ['placed', 'confirmed', 'packing'] as const;
export const BUY_LIST_UNAVAILABLE = 'BUY_LIST_UNAVAILABLE';
const EVIDENCE_PREFIX = 'buylist:';

export type BuyListLineState = 'to_buy' | 'unavailable' | 'covered';

export interface BuyListOrderLine {
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  requirementId: string;
  required: number;
  acquired: number;
  receivedAtHub: number;
  outstanding: number;
  state: BuyListLineState;
  placedAt: Date;
  promisedDate: Date | null;
}

export interface BuyListSku {
  skuId: string;
  /** Snapshot labels from the customer's order lines (the catalog identity is added by the composition layer). */
  productName: string | null;
  skuCode: string | null;
  variantName: string | null;
  /** Units still to obtain from the market (unavailable lines are not counted here). */
  toBuy: number;
  /** Units a staff member marked unavailable; the customer decides what happens to them. */
  unavailable: number;
  /** Units marked acquired. */
  acquired: number;
  /** Acquired units that have not been received (scanned) at the Hub yet. */
  awaitingHub: number;
  orderCount: number;
  earliestPromisedDate: Date | null;
  orders: BuyListOrderLine[];
}

export interface BuyListResult {
  mode: string;
  generatedAt: Date;
  totals: { skus: number; toBuy: number; unavailable: number; awaitingHub: number; orders: number };
  items: BuyListSku[];
}

/** A staff count that is limited to some order lines (a purchase batch) and takes part in the same transaction. */
export interface AcquireScope {
  /** Evaluated under the per-SKU lock: the most units each order line may take from this count. Lines not listed take nothing. */
  limits: (tx: Tx) => Promise<Map<string, number>>;
  /** Runs in the count's transaction once the allocations exist (never on an idempotent replay). */
  onCreated: (tx: Tx, created: Array<{ orderItemId: string; orderId: string; quantity: number }>) => Promise<void>;
}

export interface AcquireResult {
  skuId: string;
  acquired: number;
  replayed: boolean;
  remainingToBuy: number;
  allocations: Array<{ orderId: string; orderNumber: string; orderItemId: string; allocationId: string; quantity: number }>;
}

/**
 * Internal aggregated Buy List (GLO-296). Sourcing owns it because it is the coverage of a SupplyRequirement: demand is the
 * uncovered quantity of every open order line, grouped by exact SKU (a different size/variant is a different SKU and can never
 * merge). Marking goods acquired creates a confirmed, supplier-less SourceAllocation per order line (oldest order first) under a
 * per-SKU lock, so two staff members can never count the same unit twice and a retry with the same key changes nothing.
 * It is an internal operational marker only — never a supplier confirmation or purchase order.
 */
@Injectable()
export class BuyListService {
  private readonly logger = new Logger(BuyListService.name);

  constructor(private readonly prisma: PrismaService, private readonly supplyPlan: SupplyPlanService, private readonly purchaseCosts: PurchaseCostService) {}

  private assertActive() {
    if (!isInternalBuyListMode()) {
      throw new ConflictException({ code: 'SOURCING_MODE_INACTIVE', message: 'The internal Buy List is only active in sourcing mode INTERNAL_BUY_LIST' });
    }
  }

  /** Open demand lines (optionally of one SKU), oldest order first. Reads with the caller's client so locks apply. */
  private async openLines(db: Tx | PrismaService, skuId?: string) {
    const orders = await db.order.findMany({
      where: { status: { in: [...OPEN_ORDER_STATUSES] }, paymentMethod: 'COD',
        ...(skuId ? { items: { some: { skuId, lineState: 'active' } } } : {}) },
      select: { id: true, orderNumber: true, createdAt: true, promisedDate: true,
        items: { where: { lineState: 'active', ...(skuId ? { skuId } : {}) },
          select: { id: true, skuId: true, quantity: true, productName: true, skuCode: true, variantName: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const itemIds = orders.flatMap(order => order.items.map(item => item.id));
    if (!itemIds.length) return [];
    const [requirements, receipts] = await Promise.all([
      db.supplyRequirement.findMany({
        where: { orderItemId: { in: itemIds }, releasedAt: null },
        include: { allocations: true, actionRequirement: true },
      }),
      db.fulfillmentReceipt.groupBy({ by: ['orderItemId'], where: { orderItemId: { in: itemIds } }, _sum: { quantity: true } }),
    ]);
    const requirementByItem = new Map(requirements.map(requirement => [requirement.orderItemId, requirement]));
    const receivedByItem = new Map(receipts.map(row => [row.orderItemId, row._sum.quantity ?? 0]));
    const lines: Array<BuyListOrderLine & { skuId: string; productName: string | null; skuCode: string | null; variantName: string | null }> = [];
    for (const order of orders) {
      for (const item of order.items) {
        const requirement = requirementByItem.get(item.id);
        // No supply request yet (order.placed is still being processed): the demand appears on the next read.
        if (!requirement) continue;
        const acquired = requirement.allocations
          .filter(a => a.result === 'confirmed_full' || a.result === 'confirmed_partial')
          .reduce((sum, a) => sum + a.confirmedQuantity, 0);
        const outstanding = Math.max(requirement.requiredQuantity - acquired, 0);
        lines.push({
          skuId: item.skuId, productName: item.productName, skuCode: item.skuCode, variantName: item.variantName,
          orderId: order.id, orderNumber: order.orderNumber, orderItemId: item.id, requirementId: requirement.id,
          required: requirement.requiredQuantity, acquired, receivedAtHub: receivedByItem.get(item.id) ?? 0, outstanding,
          state: outstanding === 0 ? 'covered' : requirement.actionRequirement ? 'unavailable' : 'to_buy',
          placedAt: order.createdAt, promisedDate: order.promisedDate,
        });
      }
    }
    return lines;
  }

  /** Open demand lines for other sourcing services (purchase batches), read with the caller's client. */
  demandLines(db: Tx | PrismaService, skuId?: string) { return this.openLines(db, skuId); }

  /** The consolidated list: one row per exact SKU with the quantity summed over all open orders and the orders behind it. */
  async list(): Promise<BuyListResult> {
    const lines = await this.openLines(this.prisma);
    const bySku = new Map<string, BuyListSku>();
    for (const line of lines) {
      const awaiting = Math.max(line.acquired - line.receivedAtHub, 0);
      if (line.state === 'covered' && awaiting === 0) continue;
      let row = bySku.get(line.skuId);
      if (!row) {
        row = { skuId: line.skuId, productName: line.productName, skuCode: line.skuCode, variantName: line.variantName,
          toBuy: 0, unavailable: 0, acquired: 0, awaitingHub: 0, orderCount: 0, earliestPromisedDate: null, orders: [] };
        bySku.set(line.skuId, row);
      }
      if (line.state === 'to_buy') row.toBuy += line.outstanding;
      if (line.state === 'unavailable') row.unavailable += line.outstanding;
      row.acquired += line.acquired;
      row.awaitingHub += awaiting;
      if (line.promisedDate && (!row.earliestPromisedDate || line.promisedDate < row.earliestPromisedDate)) row.earliestPromisedDate = line.promisedDate;
      row.orders.push({ orderId: line.orderId, orderNumber: line.orderNumber, orderItemId: line.orderItemId, requirementId: line.requirementId,
        required: line.required, acquired: line.acquired, receivedAtHub: line.receivedAtHub, outstanding: line.outstanding, state: line.state,
        placedAt: line.placedAt, promisedDate: line.promisedDate });
    }
    const items = [...bySku.values()].map(row => ({ ...row, orderCount: new Set(row.orders.map(o => o.orderId)).size }))
      .sort((a, b) => (b.toBuy - a.toBuy) || a.skuId.localeCompare(b.skuId));
    return {
      mode: isInternalBuyListMode() ? 'INTERNAL_BUY_LIST' : 'INACTIVE',
      generatedAt: new Date(),
      totals: {
        skus: items.length, toBuy: items.reduce((s, r) => s + r.toBuy, 0), unavailable: items.reduce((s, r) => s + r.unavailable, 0),
        awaitingHub: items.reduce((s, r) => s + r.awaitingHub, 0), orders: new Set(items.flatMap(r => r.orders.map(o => o.orderId))).size,
      },
      items,
    };
  }

  /**
   * Staff marked `quantity` units of one SKU as obtained. Oldest orders are covered first; the quantity can never exceed what is still
   * outstanding (a concurrent count or a cancelled order makes the second request fail with the fresh number instead of over-counting).
   */
  async acquire(input: { skuId: string; quantity: number; idempotencyKey: string; actorId: string; cost?: PurchaseCostDto; scope?: AcquireScope }): Promise<AcquireResult> {
    this.assertActive();
    if (input.cost) PurchaseCostService.finalUnitCost(input.cost); // reject a bad price before anything is counted
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new BadRequestException('Quantity must be a positive whole number');
    const evidenceRef = `${EVIDENCE_PREFIX}${input.idempotencyKey}`;

    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44090, hashtext(${input.skuId}))::text AS locked`;

      const replay = await tx.sourceAllocation.findMany({ where: { evidenceRef }, include: { requirement: { select: { skuId: true, orderItemId: true } } } });
      if (replay.length) {
        const total = replay.reduce((sum, a) => sum + a.confirmedQuantity, 0);
        if (replay.some(a => a.requirement.skuId !== input.skuId) || total !== input.quantity) {
          throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request key was already used for a different count' });
        }
        // A retry may carry the cost the first attempt lacked; an existing cost is never overwritten here.
        if (input.cost && !(await tx.purchaseCostBatch.findUnique({ where: { acquireKey: input.idempotencyKey } }))) {
          await this.purchaseCosts.createInTx(tx, { acquireKey: input.idempotencyKey, skuId: input.skuId, quantity: total, cost: input.cost, actorId: input.actorId });
        }
        return { replayed: true, touched: [] as string[], allocations: await this.describe(tx, replay.map(a => ({ id: a.id, requirementId: a.requirementId, quantity: a.confirmedQuantity }))) };
      }

      // Lock every candidate order (sorted, same key space as the Supply Plan) before reading the lines that decide the split.
      const candidates = await this.openLines(tx, input.skuId);
      await this.supplyPlan.lockOrders(tx, candidates.map(line => line.orderId));
      const limits = input.scope ? await input.scope.limits(tx) : null;
      // A scoped count (a purchase batch receipt) can only cover its own order lines, and never more than each line's share.
      const lines = (await this.openLines(tx, input.skuId)).filter(line => line.state === 'to_buy' && (!limits || (limits.get(line.orderItemId) ?? 0) > 0))
        .map(line => limits ? { ...line, outstanding: Math.min(line.outstanding, limits.get(line.orderItemId)!) } : line);
      const outstanding = lines.reduce((sum, line) => sum + line.outstanding, 0);
      if (outstanding === 0) {
        throw new ConflictException({ code: 'NOTHING_OUTSTANDING', outstanding, message: 'No open order needs this product any more' });
      }
      if (input.quantity > outstanding) {
        throw new ConflictException({ code: 'EXCEEDS_OUTSTANDING', outstanding,
          message: `Only ${outstanding} unit(s) are still needed — the list changed (another count or a cancelled order)` });
      }

      let left = input.quantity;
      const created: Array<{ id: string; requirementId: string; quantity: number }> = [];
      for (const line of lines) {
        if (left === 0) break;
        const quantity = Math.min(left, line.outstanding);
        const allocation = await tx.sourceAllocation.create({ data: {
          requirementId: line.requirementId, requestedQuantity: quantity, allocatedQuantity: quantity, confirmedQuantity: quantity,
          result: 'confirmed_full', reportedResult: 'confirmed_full', reportedQuantity: quantity, confirmedAt: new Date(), evidenceRef,
        } });
        created.push({ id: allocation.id, requirementId: line.requirementId, quantity });
        left -= quantity;
      }
      if (input.cost) await this.purchaseCosts.createInTx(tx, { acquireKey: input.idempotencyKey, skuId: input.skuId, quantity: input.quantity, cost: input.cost, actorId: input.actorId });
      if (input.scope) {
        await input.scope.onCreated(tx, created.map(row => {
          const line = lines.find(l => l.requirementId === row.requirementId)!;
          return { orderItemId: line.orderItemId, orderId: line.orderId, quantity: row.quantity };
        }));
      }
      return { replayed: false, touched: [...new Set(lines.filter(l => created.some(c => c.requirementId === l.requirementId)).map(l => l.orderId))],
        allocations: await this.describe(tx, created) };
    }, { timeout: 30000 });

    // Recompute each order's plan status (COVERED → customer "availability confirmed") under its own order lock.
    for (const orderId of result.touched) await this.supplyPlan.advance(orderId);
    const remaining = (await this.list()).items.find(item => item.skuId === input.skuId)?.toBuy ?? 0;
    return { skuId: input.skuId, acquired: input.quantity, replayed: result.replayed, remainingToBuy: remaining, allocations: result.allocations };
  }

  private async describe(tx: Tx, rows: Array<{ id: string; requirementId: string; quantity: number }>) {
    const requirements = await tx.supplyRequirement.findMany({ where: { id: { in: rows.map(r => r.requirementId) } },
      include: { supplyRequest: { select: { orderId: true } } } });
    const orders = await tx.order.findMany({ where: { id: { in: requirements.map(r => r.supplyRequest.orderId) } }, select: { id: true, orderNumber: true } });
    const number = new Map(orders.map(o => [o.id, o.orderNumber]));
    return rows.map(row => {
      const requirement = requirements.find(r => r.id === row.requirementId)!;
      const orderId = requirement.supplyRequest.orderId;
      return { orderId, orderNumber: number.get(orderId) ?? '', orderItemId: requirement.orderItemId, allocationId: row.id, quantity: row.quantity };
    });
  }

  /**
   * The product cannot be found: every order line of this SKU that is still to buy (or only the named orders) is flagged for the
   * customer decision flow (replace / continue without / cancel). Already acquired units stay acquired. Idempotent.
   */
  async markUnavailable(input: { skuId: string; orderIds?: string[]; actorId: string; note?: string }): Promise<{ skuId: string; flagged: number; units: number }> {
    this.assertActive();
    const touched = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44090, hashtext(${input.skuId}))::text AS locked`;
      const candidates = await this.openLines(tx, input.skuId);
      await this.supplyPlan.lockOrders(tx, candidates.map(line => line.orderId));
      const scoped = (await this.openLines(tx, input.skuId))
        .filter(line => !input.orderIds?.length || input.orderIds.includes(line.orderId));
      // Repeating the marker is a no-op; only a SKU with no open uncovered line at all is an error.
      if (!scoped.some(line => line.state !== 'covered')) return null;
      const lines = scoped.filter(line => line.state === 'to_buy');
      for (const line of lines) {
        await tx.availabilityActionRequirement.upsert({
          where: { requirementId: line.requirementId },
          create: { requirementId: line.requirementId, category: BUY_LIST_UNAVAILABLE, unresolvedQuantity: line.outstanding },
          update: { unresolvedQuantity: line.outstanding },
        });
      }
      return lines;
    }, { timeout: 30000 });
    if (touched === null) throw new NotFoundException('No open order line of this product is waiting to be bought');
    this.logger.log(`Buy List: ${input.skuId} marked unavailable on ${touched.length} line(s) by ${input.actorId}${input.note ? ` (${input.note})` : ''}`);
    for (const orderId of new Set(touched.map(l => l.orderId))) await this.supplyPlan.advance(orderId);
    return { skuId: input.skuId, flagged: touched.length, units: touched.reduce((s, l) => s + l.outstanding, 0) };
  }

  /** Found it after all: lines flagged unavailable go back to the list unless the customer already decided. */
  async reopen(input: { skuId: string; orderIds?: string[]; actorId: string }): Promise<{ skuId: string; reopened: number }> {
    this.assertActive();
    const touched = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44090, hashtext(${input.skuId}))::text AS locked`;
      const candidates = await this.openLines(tx, input.skuId);
      await this.supplyPlan.lockOrders(tx, candidates.map(line => line.orderId));
      const lines = (await this.openLines(tx, input.skuId))
        .filter(line => line.state === 'unavailable' && (!input.orderIds?.length || input.orderIds.includes(line.orderId)));
      const removed = await tx.availabilityActionRequirement.deleteMany({
        where: { requirementId: { in: lines.map(l => l.requirementId) }, category: BUY_LIST_UNAVAILABLE },
      });
      return { removed: removed.count, orderIds: [...new Set(lines.map(l => l.orderId))] };
    }, { timeout: 30000 });
    for (const orderId of touched.orderIds) await this.supplyPlan.advance(orderId);
    return { skuId: input.skuId, reopened: touched.removed };
  }

  /** Acquired-but-not-yet-received allocations for the Hub receiving desk (same shape as purchase-order receivables). */
  async listReceivables() {
    const lines = (await this.openLines(this.prisma)).filter(line => line.acquired > line.receivedAtHub);
    if (!lines.length) return [];
    const allocations = await this.prisma.sourceAllocation.findMany({
      where: { requirementId: { in: lines.map(l => l.requirementId) }, evidenceRef: { startsWith: EVIDENCE_PREFIX }, confirmedQuantity: { gt: 0 } },
      orderBy: { selectedAt: 'asc' },
    });
    const receipts = await this.prisma.fulfillmentReceipt.groupBy({
      by: ['sourceAllocationId'], where: { sourceAllocationId: { in: allocations.map(a => a.id) } }, _sum: { quantity: true },
    });
    const received = new Map(receipts.map(row => [row.sourceAllocationId, row._sum.quantity ?? 0]));
    const lineByRequirement = new Map(lines.map(l => [l.requirementId, l]));
    return allocations.flatMap(allocation => {
      const line = lineByRequirement.get(allocation.requirementId);
      const receivedQuantity = received.get(allocation.id) ?? 0;
      if (!line || receivedQuantity >= allocation.confirmedQuantity) return [];
      return [{
        allocationId: allocation.id, orderId: line.orderId, orderItemId: line.orderItemId, skuId: line.skuId,
        confirmedQuantity: allocation.confirmedQuantity, receivedQuantity, shortQuantity: 0,
        remainingQuantity: allocation.confirmedQuantity - receivedQuantity,
        purchaseOrderId: null as string | null, purchaseOrderStatus: 'internal_buy_list', supplierName: null as string | null, readyAt: allocation.confirmedAt,
      }];
    });
  }
}
