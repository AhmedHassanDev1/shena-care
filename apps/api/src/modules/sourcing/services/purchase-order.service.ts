import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { DomainEventsService } from '../../../platform/events/domain-events.service';
import { CreatePurchaseOrderDto, ConfirmPurchaseOrderDto, DistributePurchaseOrderLineDto, ListPurchaseOrdersQueryDto, RecordShortfallDto } from '../dto/purchase-order.dto';
import { SupportService } from '../../operations/services/support.service';
import { PurchaseOrderStatus, PurchaseOrderLineStatus, Prisma } from '@prisma/client';
import { RankingService } from './ranking.service';
import { SupplyPlanService } from './supply-plan.service';

type Tx = Prisma.TransactionClient;

export const PURCHASE_ORDER_ADVANCE_CONSUMER = 'sourcing.supply-plan-advance';
const OPEN_FOR_CONFIRMATION: PurchaseOrderStatus[] = [PurchaseOrderStatus.created, PurchaseOrderStatus.sent, PurchaseOrderStatus.reviewed];
const BATCH_LOCK = 44090;

/** What a supplier may see: its own lines, quantities and approved costs — no orders, customers or rivals. */
export interface SupplierPurchaseOrderView {
  id: string; supplierId: string; status: PurchaseOrderStatus; notes: string | null; batchRef: string | null;
  issuedAt: Date | null; confirmedAt: Date | null; readyAt: Date | null; receivedAt: Date | null; createdAt: Date;
  lines: Array<{
    id: string; skuId: string; requestedQuantity: number; confirmedQuantity: number | null;
    status: PurchaseOrderLineStatus; unitCost: number | null; currency: string | null;
  }>;
}

const lineInclude = { lines: { orderBy: { createdAt: 'asc' as const }, include: { allocations: { orderBy: { createdAt: 'asc' as const } } } } };
type PurchaseOrderWithLineage = Prisma.SupplierPurchaseOrderGetPayload<{ include: typeof lineInclude }>;

@Injectable()
export class PurchaseOrderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PurchaseOrderService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rankingService: RankingService,
    private readonly supplyPlan: SupplyPlanService,
    private readonly events: DomainEventsService,
    private readonly support: SupportService,
  ) {}

  /**
   * The procurement cadence is owner policy (provisional ~12h): automatic batching runs only when
   * PROCUREMENT_BATCH_INTERVAL_MINUTES is configured; otherwise batches are flushed manually.
   */
  onModuleInit() {
    this.events.registerHandler(PURCHASE_ORDER_ADVANCE_CONSUMER, async event => {
      const orderIds = (event.payload as { orderIds?: string[] }).orderIds ?? [];
      for (const orderId of orderIds) await this.supplyPlan.advance(orderId);
    });
    const minutes = Number(process.env.PROCUREMENT_BATCH_INTERVAL_MINUTES ?? 0);
    if (minutes > 0) {
      this.timer = setInterval(() => {
        this.flushProcurementBatch('system:procurement-schedule')
          .catch(error => this.logger.error(`Scheduled procurement batch failed: ${error.message}`));
      }, minutes * 60_000);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Manual PO: the unit cost is snapshotted from the supplier's offer when the PO is created. */
  async createPurchaseOrder(dto: CreatePurchaseOrderDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier not found with id: ${dto.supplierId}`);
    }
    const offers = await this.prisma.supplierOffer.findMany({
      where: { supplierId: dto.supplierId, skuId: { in: dto.lines.map(line => line.skuId) } },
    });

    const order = await this.prisma.supplierPurchaseOrder.create({
      data: {
        supplierId: dto.supplierId,
        status: PurchaseOrderStatus.created,
        lines: {
          create: dto.lines.map((line) => {
            const offer = offers.find(o => o.skuId === line.skuId);
            return {
              skuId: line.skuId,
              requestedQuantity: line.requestedQuantity,
              status: PurchaseOrderLineStatus.pending,
              unitCost: offer?.costPrice ?? null,
              currency: offer?.currency ?? null,
              supplierOfferId: offer?.id ?? null,
            };
          }),
        },
      },
      include: {
        lines: true,
      },
    });

    return order;
  }

  /**
   * Consolidates every pending, not-yet-issued order allocation into one PO per supplier with one
   * line per SKU and approved cost; each line keeps N quantity-aware links to the order items it
   * supplies (GLO-237). Serialized by an advisory lock, and the unique link per allocation makes
   * double batching impossible even across processes.
   */
  async flushProcurementBatch(actorId: string, filter: { supplierId?: string } = {}) {
    const batchRef = 'PB-' + randomUUID();
    const created = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${BATCH_LOCK}::int4, 0::int4)::text AS locked`;
      const candidates = await tx.sourceAllocation.findMany({
        where: {
          result: 'pending', poLink: null, requirement: { releasedAt: null },
          ...(filter.supplierId ? { supplierOffer: { supplierId: filter.supplierId } } : {}),
        },
        include: { supplierOffer: true, requirement: { include: { supplyRequest: true } } },
        orderBy: { selectedAt: 'asc' },
      });
      if (!candidates.length) return [];

      const bySupplier = new Map<string, typeof candidates>();
      for (const allocation of candidates) {
        const list = bySupplier.get(allocation.supplierOffer.supplierId) ?? [];
        list.push(allocation);
        bySupplier.set(allocation.supplierOffer.supplierId, list);
      }

      const purchaseOrderIds: string[] = [];
      for (const [supplierId, allocations] of bySupplier) {
        const lines = new Map<string, typeof candidates>();
        for (const allocation of allocations) {
          const key = [allocation.requirement.skuId, allocation.selectedCost.toFixed(2), allocation.selectedCurrency, allocation.supplierOfferId].join('|');
          lines.set(key, [...(lines.get(key) ?? []), allocation]);
        }
        const po = await tx.supplierPurchaseOrder.create({ data: {
          supplierId, status: PurchaseOrderStatus.sent, batchRef, issuedAt: new Date(),
          notes: `Procurement batch ${batchRef} by ${actorId}`,
        } });
        for (const group of lines.values()) {
          const first = group[0];
          await tx.purchaseOrderLine.create({ data: {
            purchaseOrderId: po.id, skuId: first.requirement.skuId,
            requestedQuantity: group.reduce((sum, a) => sum + a.allocatedQuantity, 0),
            status: PurchaseOrderLineStatus.pending,
            unitCost: first.selectedCost, currency: first.selectedCurrency, supplierOfferId: first.supplierOfferId,
            allocations: { create: group.map(a => ({
              sourceAllocationId: a.id, orderId: a.requirement.supplyRequest.orderId,
              orderItemId: a.requirement.orderItemId, quantity: a.allocatedQuantity,
            })) },
          } });
        }
        purchaseOrderIds.push(po.id);
      }
      return purchaseOrderIds;
    }, { timeout: 30000 });

    const purchaseOrders = await this.prisma.supplierPurchaseOrder.findMany({
      where: { id: { in: created } }, include: lineInclude, orderBy: { createdAt: 'asc' },
    });
    return { batchRef: created.length ? batchRef : null, purchaseOrders };
  }

  async getPurchaseOrder(id: string) {
    const order = await this.prisma.supplierPurchaseOrder.findUnique({
      where: { id },
      include: lineInclude,
    });

    if (!order) {
      throw new NotFoundException(`PurchaseOrder not found with id: ${id}`);
    }

    return order;
  }

  /** Supplier-safe projection (no order/customer lineage). */
  toSupplierView(order: PurchaseOrderWithLineage): SupplierPurchaseOrderView {
    return {
      id: order.id, supplierId: order.supplierId, status: order.status, notes: null, batchRef: order.batchRef,
      issuedAt: order.issuedAt, confirmedAt: order.confirmedAt, readyAt: order.readyAt, receivedAt: order.receivedAt,
      createdAt: order.createdAt,
      lines: order.lines.map(line => ({
        id: line.id, skuId: line.skuId, requestedQuantity: line.requestedQuantity, confirmedQuantity: line.confirmedQuantity,
        status: line.status, unitCost: line.unitCost === null ? null : Number(line.unitCost), currency: line.currency,
      })),
    };
  }

  async listPurchaseOrders(query: ListPurchaseOrdersQueryDto, supplierId?: string) {
    const where: Prisma.SupplierPurchaseOrderWhereInput = {
      ...(supplierId ? { supplierId } : query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.supplierPurchaseOrder.findMany({
        where, include: lineInclude, orderBy: { createdAt: 'desc' }, take: query.take ?? 20, skip: query.skip ?? 0,
      }),
      this.prisma.supplierPurchaseOrder.count({ where }),
    ]);
    return { total, items };
  }

  async confirmPurchaseOrder(id: string, dto: ConfirmPurchaseOrderDto) {
    const order = await this.getPurchaseOrder(id);

    const lineIds = order.lines.map(l => l.id);
    const dtoLineIds = dto.lines.map(l => l.id);
    const missingLines = lineIds.filter((id: string) => !dtoLineIds.includes(id));

    if (missingLines.length > 0) {
      throw new BadRequestException(`Missing confirmation for lines: ${missingLines.join(', ')}`);
    }
    // Only this order's lines, each once: a confirmation must never write another order's line.
    if (dtoLineIds.length !== lineIds.length || new Set(dtoLineIds).size !== dtoLineIds.length) {
      throw new BadRequestException('Confirmation must list each line of this purchase order exactly once');
    }
    const confirmations = dto.lines.map(line => {
      const original = order.lines.find(l => l.id === line.id)!;
      return { original, line, status: line.status, quantity: this.confirmedQuantityFor(original.requestedQuantity, line),
        exception: this.lineException(original.requestedQuantity, line) };
    });

    if (!OPEN_FOR_CONFIRMATION.includes(order.status)) {
      // A late duplicate of the same answer is harmless; a different answer is a conflict.
      const sameAnswer = confirmations.every(c => c.original.status === c.status && c.original.confirmedQuantity === c.quantity);
      if (sameAnswer) return order;
      throw new ConflictException('PurchaseOrder was already confirmed');
    }

    const result = await this.prisma.$transaction(async tx => {
      let isPartial = false;
      const shortages: { skuId: string; missingQty: number }[] = [];
      const touchedOrders = new Set<string>();

      // Claim the order first so a replayed or concurrent confirmation cannot apply twice.
      const claimed = await tx.supplierPurchaseOrder.updateMany({
        where: { id, status: { in: OPEN_FOR_CONFIRMATION } },
        data: { status: PurchaseOrderStatus.confirmed, confirmedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException('PurchaseOrder was already confirmed');

      for (const { original, status, quantity, exception } of confirmations) {
        if (status !== PurchaseOrderLineStatus.confirmed_full) {
          isPartial = true;
          const missing = original.requestedQuantity - quantity;
          if (missing > 0 && !original.allocations.length) shortages.push({ skuId: original.skuId, missingQty: missing });
        }

        const needsDistribution = status === PurchaseOrderLineStatus.confirmed_partial && original.allocations.length > 1;
        await tx.purchaseOrderLine.update({
          where: { id: original.id },
          data: { status, confirmedQuantity: quantity, distributionRequired: needsDistribution, ...(exception ?? {}) },
        });
        if (exception) {
          // Never silently accepted: impossible packs/MOQs and new prices become a procurement decision,
          // while the order is re-planned from the remaining sources (customer price never changes).
          await this.support.openOperationalException(tx, {
            dedupKey: `po-line-exception:${original.id}`, category: 'sourcing', priority: 'medium', supplierId: order.supplierId,
            title: `Supplier exception ${exception.exceptionCode} on PO ${order.id.slice(0, 8)}`,
            description: [`Line ${original.id}: requested ${original.requestedQuantity}, confirmed ${quantity}.`,
              exception.proposedQuantity ? `Supplier proposes quantity ${exception.proposedQuantity}.` : null,
              exception.proposedUnitCost ? `Supplier proposes unit cost ${exception.proposedUnitCost} (PO cost ${original.unitCost?.toFixed(2) ?? 'n/a'}).` : null,
              exception.exceptionNote ?? null].filter(Boolean).join(' '),
          });
        }
        if (!needsDistribution) {
          for (const orderId of await this.applyToAllocations(tx, order.id, original.allocations, status, quantity)) touchedOrders.add(orderId);
        }
      }

      const updatedOrder = await tx.supplierPurchaseOrder.update({
        where: { id },
        data: {
          status: isPartial ? PurchaseOrderStatus.partial : PurchaseOrderStatus.confirmed,
        },
        include: lineInclude,
      });
      await this.recordAdvance(tx, 'purchase_order.confirmed', id, [...touchedOrders]);

      return { updatedOrder, shortages };
    }, { timeout: 30000 });
    this.events.dispatchSoon(id);

    // Legacy manual lines without lineage keep the previous behaviour: queue a fallback PO.
    if (result.shortages.length > 0) {
      for (const shortage of result.shortages) {
        try {
          await this.autoSourceDemand(shortage.skuId, shortage.missingQty, [order.supplierId], 0);
        } catch (err) {
          this.logger.warn(`Failed to auto-source shortage for SKU ${shortage.skuId}: ${(err as Error).message}`);
        }
      }
    }

    return result.updatedOrder;
  }

  /**
   * A full, zero or single-allocation answer maps onto the linked allocations unambiguously. A
   * partial answer shared by several orders is NOT split here: who gets scarce stock is owner
   * policy, so the line waits for an explicit distribution (GLO-237).
   */
  private async applyToAllocations(tx: Tx, purchaseOrderId: string,
    links: Array<{ id: string; sourceAllocationId: string; quantity: number }>, status: PurchaseOrderLineStatus, quantity: number,
    explicit?: Map<string, number>): Promise<string[]> {
    const orderIds: string[] = [];
    for (const link of links) {
      const q = explicit ? explicit.get(link.sourceAllocationId)!
        : status === PurchaseOrderLineStatus.confirmed_full ? link.quantity
        : status === PurchaseOrderLineStatus.confirmed_partial ? quantity : 0;
      const result = q === link.quantity ? 'confirmed_full' as const
        : q > 0 ? 'confirmed_partial' as const
        : status === PurchaseOrderLineStatus.price_changed ? 'price_changed' as const : 'unavailable' as const;
      orderIds.push(await this.supplyPlan.confirmFromPurchaseOrder(tx, link.sourceAllocationId, {
        result, confirmedQuantity: q, evidenceRef: `PO:${purchaseOrderId}`,
      }));
      await tx.purchaseOrderLineAllocation.update({ where: { id: link.id }, data: { confirmedQuantity: q } });
    }
    return orderIds;
  }

  private async recordAdvance(tx: Tx, eventType: string, aggregateId: string, orderIds: string[]) {
    if (!orderIds.length) return;
    await this.events.record(tx, { eventType, aggregateType: 'PurchaseOrder', aggregateId, payload: { orderIds } });
  }

  /**
   * Explicit, audited split of a partially confirmed shared line across its order allocations.
   * Quantities must cover every link exactly once and sum to the supplier's confirmed quantity.
   */
  async distributeLine(purchaseOrderId: string, lineId: string, dto: DistributePurchaseOrderLineDto, actorId: string) {
    const outcome = await this.prisma.$transaction(async tx => {
      const line = await tx.purchaseOrderLine.findFirst({ where: { id: lineId, purchaseOrderId }, include: { allocations: true } });
      if (!line) throw new NotFoundException('Purchase order line not found');
      if (!line.distributionRequired) throw new ConflictException('This line does not need a distribution');
      const byAllocation = new Map(dto.allocations.map(a => [a.sourceAllocationId, a.quantity]));
      if (byAllocation.size !== dto.allocations.length || byAllocation.size !== line.allocations.length ||
          line.allocations.some(link => !byAllocation.has(link.sourceAllocationId))) {
        throw new BadRequestException('List every allocation on this line exactly once');
      }
      for (const link of line.allocations) {
        const q = byAllocation.get(link.sourceAllocationId)!;
        if (q < 0 || q > link.quantity) throw new BadRequestException(`Quantity for allocation ${link.sourceAllocationId} must be 0..${link.quantity}`);
      }
      const total = [...byAllocation.values()].reduce((sum, q) => sum + q, 0);
      if (total !== line.confirmedQuantity) {
        throw new BadRequestException(`Distributed quantities must sum to the supplier-confirmed ${line.confirmedQuantity}`);
      }
      const claimed = await tx.purchaseOrderLine.updateMany({ where: { id: lineId, distributionRequired: true }, data: {
        distributionRequired: false, distributedBy: actorId, distributedAt: new Date(), distributionReason: dto.reason,
      } });
      if (claimed.count !== 1) throw new ConflictException('Line was distributed concurrently');
      const orderIds = await this.applyToAllocations(tx, purchaseOrderId, line.allocations, line.status, line.confirmedQuantity ?? 0, byAllocation);
      await this.recordAdvance(tx, 'purchase_order_line.distributed', lineId, orderIds);
      return tx.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, include: lineInclude });
    }, { timeout: 30000 });
    this.events.dispatchSoon(lineId);
    return outcome;
  }

  /** Admin queue: shared partial confirmations waiting for an explicit distribution (GLO-239). */
  async listDistributionRequired(paging: { take: number; skip: number }) {
    const where = { distributionRequired: true };
    const [total, rows] = await Promise.all([
      this.prisma.purchaseOrderLine.count({ where }),
      this.prisma.purchaseOrderLine.findMany({ where, orderBy: { updatedAt: 'asc' }, take: paging.take, skip: paging.skip,
        include: { purchaseOrder: true, allocations: true } }),
    ]);
    return { total, items: rows.map(line => ({
      purchaseOrderId: line.purchaseOrderId, lineId: line.id, supplierId: line.purchaseOrder.supplierId, skuId: line.skuId,
      requestedQuantity: line.requestedQuantity, confirmedQuantity: line.confirmedQuantity, orderAllocations: line.allocations.length,
      since: line.updatedAt,
    })) };
  }

  /**
   * Confirmed, not-yet-fully-received order lineage for Hub receiving (GLO-239): only allocations
   * whose order demand is still open. Order/customer details are resolved by the caller's scope.
   */
  async listReceivableLinks() {
    const links = await this.prisma.purchaseOrderLineAllocation.findMany({
      where: {
        confirmedQuantity: { gt: 0 },
        line: { purchaseOrder: { status: { in: [PurchaseOrderStatus.confirmed, PurchaseOrderStatus.partial, PurchaseOrderStatus.ready] } } },
        sourceAllocation: { requirement: { releasedAt: null } },
      },
      include: { line: { include: { purchaseOrder: { include: { supplier: true } } } } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return links.filter(link => link.receivedQuantity + link.shortQuantity < (link.confirmedQuantity ?? 0)).map(link => ({
      allocationId: link.sourceAllocationId, orderId: link.orderId, orderItemId: link.orderItemId, skuId: link.line.skuId,
      confirmedQuantity: link.confirmedQuantity ?? 0, receivedQuantity: link.receivedQuantity, shortQuantity: link.shortQuantity,
      remainingQuantity: (link.confirmedQuantity ?? 0) - link.receivedQuantity - link.shortQuantity,
      purchaseOrderId: link.line.purchaseOrderId, purchaseOrderStatus: link.line.purchaseOrder.status,
      supplierName: link.line.purchaseOrder.supplier.name, readyAt: link.line.purchaseOrder.readyAt,
    }));
  }

  /** Supplier says confirmed goods are ready for pickup/delivery. Not a receipt: only the Hub receives. */
  async markReady(id: string) {
    const order = await this.getPurchaseOrder(id);
    if (order.status === PurchaseOrderStatus.ready || order.status === PurchaseOrderStatus.received_at_hub) return order;
    if (order.status !== PurchaseOrderStatus.confirmed && order.status !== PurchaseOrderStatus.partial) {
      throw new ConflictException(`PurchaseOrder cannot be ready in status ${order.status}`);
    }
    if (!order.lines.some(line => (line.confirmedQuantity ?? 0) > 0)) {
      throw new ConflictException('Nothing was confirmed on this purchase order');
    }
    await this.prisma.supplierPurchaseOrder.updateMany({
      where: { id, status: { in: [PurchaseOrderStatus.confirmed, PurchaseOrderStatus.partial] } },
      data: { status: PurchaseOrderStatus.ready, readyAt: new Date() },
    });
    return this.getPurchaseOrder(id);
  }

  /**
   * Owner hook called by Fulfillment inside the Hub receipt transaction: counts physical arrivals on
   * the PO line link; the PO becomes received_at_hub only when every confirmed quantity has arrived.
   */
  async recordAllocationReceipt(tx: Tx, sourceAllocationId: string, quantity: number): Promise<void> {
    const link = await tx.purchaseOrderLineAllocation.findUnique({ where: { sourceAllocationId }, include: { line: true } });
    if (!link) return;
    const updated = await tx.purchaseOrderLineAllocation.update({
      where: { id: link.id }, data: { receivedQuantity: { increment: quantity } },
    });
    if (updated.confirmedQuantity !== null && updated.receivedQuantity + updated.shortQuantity > updated.confirmedQuantity) {
      throw new ConflictException('Received quantity exceeds the supplier-confirmed quantity');
    }
    await this.completeIfAllArrived(tx, link.line.purchaseOrderId);
  }

  /** A supplier exception must explain a non-full answer consistently; it is recorded, never applied. */
  private lineException(requested: number, line: { status: PurchaseOrderLineStatus; exceptionCode?: string; exceptionNote?: string;
    proposedQuantity?: number; proposedUnitCost?: number }) {
    const code = line.exceptionCode ?? (line.status === PurchaseOrderLineStatus.price_changed ? 'PRICE_CHANGED' : undefined);
    if (!code) {
      if (line.proposedQuantity !== undefined || line.proposedUnitCost !== undefined) throw new BadRequestException('Proposals need an exceptionCode');
      return null;
    }
    if (line.status === PurchaseOrderLineStatus.confirmed_full) throw new BadRequestException('A fully confirmed line has no exception');
    if ((code === 'MIN_ORDER_QUANTITY' || code === 'PACK_SIZE') && !(line.proposedQuantity && line.proposedQuantity > requested)) {
      throw new BadRequestException(`${code} needs the supplier's proposedQuantity above the requested ${requested}`);
    }
    if (code === 'PRICE_CHANGED' && line.status !== PurchaseOrderLineStatus.price_changed) {
      throw new BadRequestException('A price change is answered with status price_changed');
    }
    return { exceptionCode: code, exceptionNote: line.exceptionNote ?? null, proposedQuantity: line.proposedQuantity ?? null,
      proposedUnitCost: line.proposedUnitCost ?? null };
  }

  /**
   * Hub records confirmed units that did not arrive and where they were lost (GLO-243: e.g. 8 ready,
   * 7 handed over, 6 received → 1 NOT_HANDED_OVER + 1 LOST_IN_TRANSIT). The units stop counting as
   * coverage (the order is re-planned), the PO can complete and is paid only for what arrived, and
   * a sourcing exception records the discrepancy. Never invents received stock.
   */
  async recordShortfall(purchaseOrderId: string, dto: RecordShortfallDto, actorId: string) {
    const outcome = await this.prisma.$transaction(async tx => {
      const link = await tx.purchaseOrderLineAllocation.findUnique({ where: { sourceAllocationId: dto.sourceAllocationId }, include: { line: true } });
      if (!link || link.line.purchaseOrderId !== purchaseOrderId) throw new NotFoundException('Allocation is not on this purchase order');
      await tx.$queryRaw`SELECT id FROM "sourcing"."purchase_order_line_allocations" WHERE id = ${link.id}::uuid FOR UPDATE`;
      const current = await tx.purchaseOrderLineAllocation.findUniqueOrThrow({ where: { id: link.id } });
      const outstanding = (current.confirmedQuantity ?? 0) - current.receivedQuantity - current.shortQuantity;
      if (dto.quantity > outstanding) throw new BadRequestException(`Only ${Math.max(outstanding, 0)} confirmed unit(s) are still outstanding`);
      const shortfall = await tx.receivingShortfall.create({ data: {
        linkId: link.id, quantity: dto.quantity, reasonCode: dto.reasonCode, notes: dto.notes, actorId,
      } });
      await tx.purchaseOrderLineAllocation.update({ where: { id: link.id }, data: { shortQuantity: { increment: dto.quantity } } });
      const orderId = await this.supplyPlan.reduceForShortfall(tx, dto.sourceAllocationId, dto.quantity);
      await this.completeIfAllArrived(tx, purchaseOrderId);
      await this.support.openOperationalException(tx, {
        dedupKey: `shortfall:${shortfall.id}`, category: 'sourcing', priority: 'high', orderId,
        title: `Receiving shortfall ${dto.reasonCode} on PO ${purchaseOrderId.slice(0, 8)}`,
        description: `${dto.quantity} confirmed unit(s) for allocation ${dto.sourceAllocationId} did not arrive (${dto.reasonCode}). ${dto.notes ?? ''}`.trim(),
      });
      await this.recordAdvance(tx, 'purchase_order.shortfall', shortfall.id, [orderId]);
      return shortfall;
    }, { timeout: 30000 });
    this.events.dispatchSoon(outcome.id);
    return outcome;
  }

  private async completeIfAllArrived(tx: Tx, purchaseOrderId: string) {
    const links = await tx.purchaseOrderLineAllocation.findMany({ where: { line: { purchaseOrderId } } });
    const settled = links.every(l => l.receivedQuantity + l.shortQuantity >= (l.confirmedQuantity ?? 0));
    if (settled && links.some(l => l.receivedQuantity > 0)) {
      await tx.supplierPurchaseOrder.updateMany({
        where: { id: purchaseOrderId, status: { in: [PurchaseOrderStatus.confirmed, PurchaseOrderStatus.partial, PurchaseOrderStatus.ready] } },
        data: { status: PurchaseOrderStatus.received_at_hub, receivedAt: new Date() },
      });
    }
  }

  /** The confirmed quantity must agree with the line status and never exceed what was requested. */
  private confirmedQuantityFor(requested: number, line: { status: PurchaseOrderLineStatus; confirmedQuantity?: number }): number {
    const quantity = line.confirmedQuantity;
    switch (line.status) {
      case PurchaseOrderLineStatus.confirmed_full:
        if (quantity !== undefined && quantity !== requested) throw new BadRequestException('A fully confirmed line must confirm the requested quantity');
        return requested;
      case PurchaseOrderLineStatus.confirmed_partial:
        if (quantity === undefined || quantity <= 0 || quantity >= requested) {
          throw new BadRequestException('A partially confirmed line needs a quantity between 1 and the requested quantity');
        }
        return quantity;
      case PurchaseOrderLineStatus.unavailable:
      case PurchaseOrderLineStatus.price_changed:
        if (quantity !== undefined && quantity !== 0) throw new BadRequestException(`A ${line.status} line confirms no quantity`);
        return 0;
      default:
        throw new BadRequestException(`Line status ${line.status} is not a confirmation`);
    }
  }

  async autoSourceDemand(skuId: string, quantity: number, excludedSupplierIds: string[] = [], loopCount: number = 0) {
    if (loopCount >= 3) {
      throw new BadRequestException(`Maximum auto-sourcing loop reached for SKU ${skuId}. No reliable supplier found.`);
    }

    const ranking = await this.rankingService.rankOffersForSku(skuId, quantity);

    // Filter out excluded suppliers (those who already rejected/partialed this demand loop)
    const validOffers = ranking.rankedOffers.filter(o => !excludedSupplierIds.includes(o.supplierId));

    if (validOffers.length === 0) {
      throw new NotFoundException(`No alternative suppliers found for shortage of SKU ${skuId}`);
    }

    const bestOffer = validOffers[0];

    const newOrder = await this.prisma.supplierPurchaseOrder.create({
      data: {
        supplierId: bestOffer.supplierId,
        status: PurchaseOrderStatus.created,
        notes: `Auto-sourced fallback (Log ID: ${ranking.decisionLogId})`,
        lines: {
          create: [{
            skuId,
            requestedQuantity: quantity,
            status: PurchaseOrderLineStatus.pending,
            unitCost: bestOffer.costPrice,
            currency: bestOffer.currency,
            supplierOfferId: bestOffer.id,
          }]
        }
      },
      include: { lines: true }
    });

    return newOrder;
  }
}
