import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { DomainEventsService } from '../../../platform/events/domain-events.service';
import { CreatePurchaseOrderDto, ConfirmPurchaseOrderDto, DistributePurchaseOrderLineDto, ListPurchaseOrdersQueryDto, RecordShortfallDto } from '../dto/purchase-order.dto';
import { SupportService } from '../../operations/services/support.service';
import { PurchaseOrderStatus, PurchaseOrderLineStatus, Prisma } from '@prisma/client';
import { RankingService } from './ranking.service';
import { SupplyPlanService } from './supply-plan.service';
import {
  canSupplierReceiveOrder,
  isEligibleForScheduledBatch,
  isSupplierOperating,
  nextDispatchCheckpoint,
  nextOpening,
  supplierResponseDeadline,
} from './supplier-schedule';
import { getProcurementBatchConfig, getSupplierResponseMinutes } from '../config/procurement-batch.config';
import { allocateScarceQuantity, committedDeliveryDeadline } from './procurement-policy';

type Tx = Prisma.TransactionClient;

export const PURCHASE_ORDER_ADVANCE_CONSUMER = 'sourcing.supply-plan-advance';
const OPEN_FOR_CONFIRMATION: PurchaseOrderStatus[] = [PurchaseOrderStatus.created, PurchaseOrderStatus.sent, PurchaseOrderStatus.reviewed];
const BATCH_LOCK = 44090;

export interface FlushBatchOptions {
  supplierId?: string;
  reason?: string;
  force?: boolean;
  isEarlyFlush?: boolean;
  now?: Date;
  /** Internal event-driven recovery, scoped to the orders whose supplier just answered. */
  orderIds?: string[];
  expedited?: boolean;
  recoveryOnly?: boolean;
}

/** What a supplier may see: its own lines, quantities and approved costs — no orders, customers or rivals. */
export interface SupplierPurchaseOrderView {
  id: string; supplierId: string; status: PurchaseOrderStatus; notes: string | null; batchRef: string | null;
  issuedAt: Date | null; openedAt: Date | null; confirmedAt: Date | null; readyAt: Date | null; receivedAt: Date | null; createdAt: Date;
  responseDeadlineAt: Date | null; expedited: boolean;
  lines: Array<{
    id: string; skuId: string; requestedQuantity: number; confirmedQuantity: number | null;
    status: PurchaseOrderLineStatus; unitCost: number | null; currency: string | null;
    exceptionCode: string | null; exceptionNote: string | null; proposedQuantity: number | null; proposedUnitCost: number | null;
  }>;
}

const lineInclude = { lines: { orderBy: { createdAt: 'asc' as const }, include: { allocations: { orderBy: { createdAt: 'asc' as const } } } } };
type PurchaseOrderWithLineage = Prisma.SupplierPurchaseOrderGetPayload<{ include: typeof lineInclude }>;

@Injectable()
export class PurchaseOrderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PurchaseOrderService.name);
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rankingService: RankingService,
    private readonly supplyPlan: SupplyPlanService,
    private readonly events: DomainEventsService,
    private readonly support: SupportService,
  ) {}

  /**
   * Procurement cadence (owner decision 2026-10-25): pending demand is consolidated into one purchase order per
   * supplier every 3 hours. PROCUREMENT_BATCH_INTERVAL_MINUTES overrides it (0 turns automatic batching off); tests
   * stay manual unless it is set.
   */
  onModuleInit() {
    this.events.registerHandler(PURCHASE_ORDER_ADVANCE_CONSUMER, async event => {
      const orderIds = (event.payload as { orderIds?: string[] }).orderIds ?? [];
      for (const orderId of orderIds) await this.supplyPlan.advance(orderId);
      if (orderIds.length) await this.flushProcurementBatch('system:supplier-recovery', {
        orderIds, expedited: true, isEarlyFlush: true, reason: `Recovery from ${event.eventType}`,
      });
    });
    this.events.registerHandler('sourcing.batch-audit', async () => {});

    const config = getProcurementBatchConfig();
    if (process.env.NODE_ENV !== 'test' || config.intervalMinutes > 0) {
      this.timer = setInterval(() => {
        if (this.checking) return;
        this.checking = true;
        this.distributePendingLines().then(() => this.expireDuePurchaseOrders())
          .then(() => this.flushProcurementBatch('system:supplier-recovery', { recoveryOnly: true, expedited: true, isEarlyFlush: true }))
          .then(() => config.intervalMinutes > 0 ? this.flushProcurementBatch('system:procurement-schedule', { isEarlyFlush: false }) : undefined)
          .catch(error => this.logger.error(`Scheduled procurement batch failed: ${error.message}`))
          .finally(() => { this.checking = false; });
      }, 60_000);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Standalone procurement has no customer allocation authority; history remains readable. */
  async createPurchaseOrder(dto: CreatePurchaseOrderDto) {
    void dto;
    throw new ConflictException('Purchase orders require allocation lineage; use the procurement batch');
  }

  /**
   * Consolidates every eligible pending, not-yet-issued order allocation into one PO per supplier with one
   * line per SKU and approved cost; each line keeps N quantity-aware links to the order items it
   * supplies (GLO-237, GLO-283). Respects supplier operating windows, working days, and cutoffs.
   * Serialized by an advisory lock; unique link per allocation guarantees exactly-once PO creation.
   */
  async flushProcurementBatch(actorId: string, filterOrOptions: FlushBatchOptions = {}) {
    const batchId = randomUUID();
    const batchRef = 'PB-' + batchId;
    const now = filterOrOptions.now ?? new Date();
    const isEarlyFlush = filterOrOptions.isEarlyFlush ?? (actorId !== 'system:procurement-schedule');
    const config = getProcurementBatchConfig();

    const enforceWindow = filterOrOptions.expedited || !filterOrOptions.force && (
      process.env.STRICT_OPERATING_WINDOW === 'true' ||
      process.env.NODE_ENV !== 'test' ||
      filterOrOptions.now !== undefined
    );

    if (filterOrOptions.supplierId) {
      const targetSupplier = await this.prisma.supplier.findUnique({
        where: { id: filterOrOptions.supplierId },
      });
      if (!targetSupplier) {
        throw new NotFoundException(`Supplier not found with id: ${filterOrOptions.supplierId}`);
      }
      if (enforceWindow && isEarlyFlush) {
        const schedule = {
          closedWeekdays: targetSupplier.closedWeekdays,
          closedDates: targetSupplier.closedDates,
          opensAt: targetSupplier.opensAt,
          closesAt: targetSupplier.closesAt,
        };
        if (!canSupplierReceiveOrder(now, schedule, config.timeZone)) {
          throw new BadRequestException(
            `Supplier ${targetSupplier.name} is currently closed and outside operating window; orders will wait for next opening.`,
          );
        }
      }
    }

    let recoveryRecorded = false;
    const created = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${BATCH_LOCK}::int4, 0::int4)::text AS locked`;
      let candidates = await tx.sourceAllocation.findMany({
        take: 500,
        where: {
          result: 'pending', poLink: null, requirement: { releasedAt: null,
            ...(filterOrOptions.recoveryOnly ? { allocations: { some: { result: { not: 'pending' } } } } : {}),
            ...(filterOrOptions.orderIds ? { supplyRequest: { orderId: { in: filterOrOptions.orderIds } } } : {}) },
          ...(filterOrOptions.supplierId ? { supplierOffer: { supplierId: filterOrOptions.supplierId } } : {}),
        },
        include: { supplierOffer: { include: { supplier: true } }, requirement: { include: { supplyRequest: true } } },
        orderBy: { selectedAt: 'asc' },
      });
      if (!candidates.length) return [];
      await this.supplyPlan.lockOrders(tx, candidates.map(a => a.requirement.supplyRequest.orderId));
      for (const supplierId of [...new Set(candidates.map(a => a.supplierOffer.supplierId))].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commit:supplier:${supplierId}`}))`;
      }
      const checked = await this.supplyPlan.validatePendingAllocations(tx, candidates.map(a => a.id), filterOrOptions.expedited ?? false, now);
      candidates = checked.eligible;
      if (checked.invalidOrderIds.length) {
        await this.recordAdvance(tx, 'purchase_order.recovery_required', batchId, checked.invalidOrderIds);
        recoveryRecorded = true;
      }

      const bySupplier = new Map<string, typeof candidates>();
      for (const allocation of candidates) {
        const list = bySupplier.get(allocation.supplierOffer.supplierId) ?? [];
        list.push(allocation);
        bySupplier.set(allocation.supplierOffer.supplierId, list);
      }

      const purchaseOrderIds: string[] = [];
      for (const [supplierId, allocations] of bySupplier) {
        const supplier = allocations[0].supplierOffer.supplier;
        const schedule = {
          closedWeekdays: supplier.closedWeekdays,
          closedDates: supplier.closedDates,
          opensAt: supplier.opensAt,
          closesAt: supplier.closesAt,
        };

        let eligibleAllocations = allocations;
        if (enforceWindow) {
          if (!canSupplierReceiveOrder(now, schedule, config.timeZone)) {
            // Closed supplier: pending demand waits for the next eligible batch
            continue;
          }
          if (!isEarlyFlush) {
            // Scheduled batch: enforce cutoff and 00:00-01:00 hold policy
            eligibleAllocations = allocations.filter(a =>
              isEligibleForScheduledBatch(a.selectedAt, now, schedule, config.timeZone)
            );
            if (!eligibleAllocations.length) continue;
          }
        }

        const lines = new Map<string, typeof eligibleAllocations>();
        for (const allocation of eligibleAllocations) {
          const key = [allocation.requirement.skuId, allocation.selectedCost.toFixed(2), allocation.selectedCurrency, allocation.supplierOfferId].join('|');
          lines.set(key, [...(lines.get(key) ?? []), allocation]);
        }
        if (!lines.size) continue;

        const auditReason = filterOrOptions.reason ? ` - ${filterOrOptions.reason}` : (isEarlyFlush ? ' - Early flush' : ' - Scheduled batch');
        const po = await tx.supplierPurchaseOrder.create({ data: {
          supplierId, status: PurchaseOrderStatus.sent, batchRef, issuedAt: now,
          expedited: filterOrOptions.expedited ?? false,
          responseDeadlineAt: supplierResponseDeadline(now, schedule, getSupplierResponseMinutes(filterOrOptions.expedited)),
          notes: `Procurement batch ${batchRef} by ${actorId}${auditReason}`,
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

      if (purchaseOrderIds.length > 0) {
        await this.events.record(tx, {
          eventType: 'purchase_order.batch_flushed',
          aggregateType: 'ProcurementBatch',
          aggregateId: batchId,
          payload: {
            batchRef,
            actorId,
            reason: filterOrOptions.reason ?? (isEarlyFlush ? 'Early flush' : 'Scheduled batch'),
            supplierId: filterOrOptions.supplierId ?? null,
            purchaseOrderIds,
            count: purchaseOrderIds.length,
            timestamp: now.toISOString(),
            isEarlyFlush,
          },
        });
      }

      return purchaseOrderIds;
    }, { timeout: 30000 });
    if (recoveryRecorded) this.events.dispatchSoon(batchId);

    const purchaseOrders = await this.prisma.supplierPurchaseOrder.findMany({
      where: { id: { in: created } }, include: lineInclude, orderBy: { createdAt: 'asc' },
    });
    return { batchRef: created.length ? batchRef : null, purchaseOrders };
  }

  /**
   * Operational queue visibility (GLO-283): pending, open, and waiting demand per supplier,
   * current supplier open/closed status, and next scheduled dispatch checkpoints.
   */
  async getBatchQueueStatus(now = new Date()) {
    const config = getProcurementBatchConfig();
    const [totalPendingAllocations, activeSuppliers, recentOrders] = await Promise.all([
      this.prisma.sourceAllocation.count({ where: { result: 'pending', poLink: null, requirement: { releasedAt: null } } }),
      this.prisma.supplier.findMany({
        where: { isActive: true },
        select: { id: true, name: true, closedWeekdays: true, closedDates: true, opensAt: true, closesAt: true },
        orderBy: { name: 'asc' }, take: 500,
      }),
      this.prisma.supplierPurchaseOrder.findMany({
        where: { batchRef: { not: null } },
        select: { id: true, batchRef: true, supplierId: true, status: true, issuedAt: true, notes: true },
        orderBy: { issuedAt: 'desc' },
        take: 10,
      }),
    ]);

    const pending = activeSuppliers.length ? await this.prisma.$queryRaw<Array<{ supplier_id: string; quantity: bigint }>>`
      SELECT offer.supplier_id, sum(a.allocated_quantity)::bigint AS quantity
      FROM sourcing.source_allocations a
      JOIN sourcing.supplier_offers offer ON offer.id = a.supplier_offer_id
      JOIN sourcing.supply_requirements requirement ON requirement.id = a.requirement_id
      WHERE a.result = 'pending' AND requirement.released_at IS NULL
        AND offer.supplier_id IN (${Prisma.join(activeSuppliers.map(s => Prisma.sql`${s.id}::uuid`))})
        AND NOT EXISTS (SELECT 1 FROM sourcing.purchase_order_line_allocations link WHERE link.source_allocation_id = a.id)
      GROUP BY offer.supplier_id` : [];
    const pendingBySupplier = new Map(pending.map(row => [row.supplier_id, Number(row.quantity)]));

    const suppliers = activeSuppliers.map(s => {
      const schedule = { closedWeekdays: s.closedWeekdays, closedDates: s.closedDates, opensAt: s.opensAt, closesAt: s.closesAt };
      const operating = isSupplierOperating(now, schedule, config.timeZone);
      return {
        id: s.id,
        name: s.name,
        operating,
        canReceive: operating,
        nextOpening: nextOpening(now, schedule, { defaultToOperatingWindow: true }).toISOString(),
        pendingQuantity: pendingBySupplier.get(s.id) ?? 0,
      };
    });

    return {
      now: now.toISOString(),
      timeZone: config.timeZone,
      nextCheckpoint: nextDispatchCheckpoint(now, config.dispatchCheckpoints, config.timeZone).toISOString(),
      totalPendingAllocations,
      suppliers,
      recentBatches: recentOrders,
    };
  }

  /**
   * Purchase orders a supplier has not reacted to (owner decision 2026-10-25): not opened 30 minutes, or not answered
   * 2 hours, after the supplier could first see them — a PO sent on a Friday or at night starts its clock at the
   * supplier's next opening. The owner phones the supplier; nothing is reassigned automatically.
   */
  async listOverdueResponses(now = new Date()) {
    const minutes = (raw: string | undefined, fallback: number) => (Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : fallback);
    const unopenedAfter = minutes(process.env.PO_UNOPENED_ALERT_MINUTES, 30);
    const unansweredAfter = minutes(process.env.PO_UNANSWERED_ALERT_MINUTES, 120);
    const orders = await this.prisma.supplierPurchaseOrder.findMany({
      where: { status: { in: OPEN_FOR_CONFIRMATION }, issuedAt: { not: null } },
      include: { supplier: true, lines: true }, orderBy: { issuedAt: 'asc' }, take: 500,
    });
    const unopened: Array<ReturnType<typeof view>> = [];
    const unanswered: Array<ReturnType<typeof view>> = [];
    const view = (po: (typeof orders)[number], waitingSince: Date, waitedMinutes: number) => ({
      purchaseOrderId: po.id, supplierId: po.supplierId, supplierName: po.supplier.name, issuedAt: po.issuedAt as Date,
      waitingSince, waitedMinutes, opened: po.openedAt !== null, lineCount: po.lines.length,
      totalCost: po.lines.reduce((sum, line) => sum + (line.unitCost ? Number(line.unitCost) * line.requestedQuantity : 0), 0),
      currency: po.lines.find(line => line.currency)?.currency ?? null,
    });
    for (const po of orders) {
      const waitingSince = nextOpening(po.issuedAt as Date, { closedWeekdays: po.supplier.closedWeekdays, opensAt: po.supplier.opensAt, closesAt: po.supplier.closesAt });
      const waited = Math.floor((now.getTime() - waitingSince.getTime()) / 60_000);
      if (waited >= unansweredAfter) unanswered.push(view(po, waitingSince, waited));
      else if (!po.openedAt && waited >= unopenedAfter) unopened.push(view(po, waitingSince, waited));
    }
    return { unopened, unanswered };
  }

  /** Claim due orders before releasing allocations; a late answer can never race fallback successfully. */
  async expireDuePurchaseOrders(now = new Date()) {
    // Upgrade existing issued POs in bounded batches; unsent drafts have no response clock.
    const legacy = await this.prisma.supplierPurchaseOrder.findMany({
      where: { status: { in: OPEN_FOR_CONFIRMATION }, issuedAt: { not: null }, responseDeadlineAt: null },
      include: { supplier: true }, take: 100,
    });
    for (const po of legacy) await this.prisma.supplierPurchaseOrder.updateMany({
      where: { id: po.id, responseDeadlineAt: null, status: { in: OPEN_FOR_CONFIRMATION } },
      data: { responseDeadlineAt: supplierResponseDeadline(po.issuedAt!, po.supplier, getSupplierResponseMinutes(po.expedited)) },
    });
    const due = await this.prisma.supplierPurchaseOrder.findMany({
      where: { status: { in: OPEN_FOR_CONFIRMATION }, responseDeadlineAt: { lte: now } },
      select: { id: true }, orderBy: { responseDeadlineAt: 'asc' }, take: 100,
    });
    for (const candidate of due) {
      await this.prisma.$transaction(async tx => {
        const claimed = await tx.supplierPurchaseOrder.updateMany({
          where: { id: candidate.id, status: { in: OPEN_FOR_CONFIRMATION }, responseDeadlineAt: { lte: now } },
          data: { status: PurchaseOrderStatus.expired },
        });
        if (!claimed.count) return;
        const po = await tx.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: candidate.id }, include: lineInclude });
        const orderIds = new Set<string>();
        for (const line of po.lines) {
          await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { status: PurchaseOrderLineStatus.unavailable, confirmedQuantity: 0 } });
          for (const orderId of await this.applyToAllocations(tx, po.id, line.allocations, PurchaseOrderLineStatus.unavailable, 0)) orderIds.add(orderId);
        }
        await this.recordAdvance(tx, 'purchase_order.expired', po.id, [...orderIds]);
      }, { timeout: 30000 });
      // Drain each committed expiry in sequence; do not fan out 100 competing DB workers.
      // A crash here is safe: the event is already durable and the regular dispatcher retries it.
      await this.events.dispatchPending({ aggregateId: candidate.id });
    }
    return due.length;
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

  /** Record when a supplier account first views or opens a purchase order. */
  async recordOpen(id: string): Promise<PurchaseOrderWithLineage> {
    const order = await this.getPurchaseOrder(id);
    if (!order.openedAt) {
      const now = new Date();
      await this.prisma.supplierPurchaseOrder.update({
        where: { id },
        data: { openedAt: now },
      });
      order.openedAt = now;
    }
    return order;
  }

  /** Supplier-safe projection (no order/customer lineage). */
  toSupplierView(order: PurchaseOrderWithLineage): SupplierPurchaseOrderView {
    return {
      id: order.id, supplierId: order.supplierId, status: order.status, notes: null, batchRef: order.batchRef,
      issuedAt: order.issuedAt, responseDeadlineAt: order.responseDeadlineAt, expedited: order.expedited,
      openedAt: order.openedAt, confirmedAt: order.confirmedAt, readyAt: order.readyAt, receivedAt: order.receivedAt,
      createdAt: order.createdAt,
      lines: order.lines.map(line => ({
        id: line.id, skuId: line.skuId, requestedQuantity: line.requestedQuantity, confirmedQuantity: line.confirmedQuantity,
        status: line.status, unitCost: line.unitCost === null ? null : Number(line.unitCost), currency: line.currency,
        // The supplier's own reported exception (MOQ/pack/price) so its inbox shows what it answered.
        exceptionCode: line.exceptionCode, exceptionNote: line.exceptionNote, proposedQuantity: line.proposedQuantity,
        proposedUnitCost: line.proposedUnitCost === null ? null : Number(line.proposedUnitCost),
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

  async reportExpiryDispute(id: string, note: string) {
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'po-expiry-dispute:' + id}))`;
      const po = await tx.supplierPurchaseOrder.findUniqueOrThrow({ where: { id } });
      if (po.status !== 'expired' && !(OPEN_FOR_CONFIRMATION.includes(po.status) && po.responseDeadlineAt && po.responseDeadlineAt <= new Date())) {
        throw new ConflictException('Only expired authorizations require expiry reconciliation');
      }
      await this.support.openOperationalException(tx, { dedupKey: 'po-expiry-dispute:' + id,
        category: 'sourcing', priority: 'high', supplierId: po.supplierId,
        title: 'Disputed handover for expired PO ' + id.slice(0, 8),
        description: 'PO ' + id + '. Supplier reports: ' + note + '. No procurement or Hub receipt is authorized by this report.',
      });
    });
    return { recorded: true };
  }

  async confirmPurchaseOrder(id: string, dto: ConfirmPurchaseOrderDto) {
    const order = await this.getPurchaseOrder(id);
    if (order.issuedAt && !order.responseDeadlineAt && OPEN_FOR_CONFIRMATION.includes(order.status)) {
      const supplier = await this.prisma.supplier.findUniqueOrThrow({ where: { id: order.supplierId } });
      order.responseDeadlineAt = supplierResponseDeadline(order.issuedAt, supplier, getSupplierResponseMinutes(order.expedited));
      await this.prisma.supplierPurchaseOrder.updateMany({ where: { id, responseDeadlineAt: null, status: { in: OPEN_FOR_CONFIRMATION } },
        data: { responseDeadlineAt: order.responseDeadlineAt } });
    }
    if (order.status === PurchaseOrderStatus.expired || (OPEN_FOR_CONFIRMATION.includes(order.status) && order.responseDeadlineAt && order.responseDeadlineAt <= new Date())) {
      throw new ConflictException('Purchase order expired; do not prepare or hand over goods against this PO');
    }

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

    if (order.lines.some(line => !line.allocations.length)) {
      throw new ConflictException('Legacy purchase order has no allocation lineage; reconcile with operations before new authorization');
    }
    const result = await this.prisma.$transaction(async tx => {
      let isPartial = false;
      const touchedOrders = new Set<string>();

      // Claim the order first so a replayed or concurrent confirmation cannot apply twice.
      const claimed = await tx.supplierPurchaseOrder.updateMany({
        where: { id, status: { in: OPEN_FOR_CONFIRMATION },
          OR: [{ responseDeadlineAt: null }, { responseDeadlineAt: { gt: new Date() } }] },
        data: { status: PurchaseOrderStatus.confirmed, confirmedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException('PurchaseOrder was already confirmed');
      const linkedOrders = order.lines.flatMap(line => line.allocations.map(link => link.orderId));
      if (linkedOrders.length) await this.supplyPlan.lockOrders(tx, linkedOrders);

      for (const { original, status, quantity, exception } of confirmations) {
        if (quantity < original.requestedQuantity && original.supplierOfferId) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commit:supplier:${order.supplierId}`}))`;
          await tx.supplierOffer.update({ where: { id: original.supplierOfferId },
            data: { isAvailable: false, shortageObservedAt: new Date() } });
        }
        if (status !== PurchaseOrderLineStatus.confirmed_full) {
          isPartial = true;
        }

        const needsDistribution = status === PurchaseOrderLineStatus.confirmed_partial && original.allocations.length > 1;
        const split = needsDistribution ? await this.automaticDistribution(tx, original, quantity) : null;
        await tx.purchaseOrderLine.update({
          where: { id: original.id },
          data: { status, confirmedQuantity: quantity, distributionRequired: needsDistribution && !split,
            ...(split ? { distributedBy: 'system:delivery-ready-fifo-v1', distributedAt: new Date(), distributionReason: split.audit } : {}),
            ...(exception ?? {}) },
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
        if (!needsDistribution || split) {
          for (const orderId of await this.applyToAllocations(tx, order.id, original.allocations, status, quantity, split?.quantities)) touchedOrders.add(orderId);
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

      return { updatedOrder };
    }, { timeout: 30000 });
    this.events.dispatchSoon(id);

    return result.updatedOrder;
  }

  private async automaticDistribution(tx: Tx, line: PurchaseOrderWithLineage['lines'][number], quantity: number) {
    const ids = [...new Set(line.allocations.map(link => link.orderId))];
    const [orders, requests] = await Promise.all([
      tx.order.findMany({ where: { id: { in: ids } }, select: { id: true, promisedDate: true, createdAt: true, status: true } }),
      tx.supplyRequest.findMany({ where: { orderId: { in: ids } }, include: { requirements: { where: { releasedAt: null },
        include: { allocations: { include: { poLink: { select: { receivedQuantity: true } } } } } } } }),
    ]);
    const entries = line.allocations.map(link => {
      const order = orders.find(o => o.id === link.orderId);
      const request = requests.find(r => r.orderId === link.orderId);
      const current = request?.requirements.find(r => r.orderItemId === link.orderItemId);
      if (!order || !current || !['placed', 'confirmed', 'packing'].includes(order.status)) return null;
      return { id: link.sourceAllocationId, orderId: order.id, quantity: link.quantity,
        deliveryDeadline: committedDeliveryDeadline(order.promisedDate)?.getTime() ?? Number.MAX_SAFE_INTEGER,
        otherwiseReady: request!.requirements.filter(r => r.id !== current.id).every(r =>
          r.allocations.reduce((sum, a) => sum + (a.poLink?.receivedQuantity ?? 0), 0) >= r.requiredQuantity),
        orderCreatedAt: order.createdAt.getTime() };
    });
    if (entries.some(entry => entry === null)) {
      await this.support.openOperationalException(tx, { dedupKey: `po-distribution-conflict:${line.id}`,
        category: 'sourcing', priority: 'high', title: 'Supplier confirmation conflicts with cancelled or amended demand',
        description: `Line ${line.id}: keep ${quantity} confirmed units held for reconciliation; no replacement commitment issued.` });
      return null;
    }
    const active = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const quantities = allocateScarceQuantity(active, quantity);
    return { quantities, audit: JSON.stringify({ policy: 'delivery-ready-fifo-v1', entries: active.map(entry => ({ ...entry, allocated: quantities.get(entry.id) })) }) };
  }

  /** Bounded restart recovery for shared partial lines confirmed before the automatic policy was installed. */
  async distributePendingLines() {
    const pending = await this.prisma.purchaseOrderLine.findMany({ where: { distributionRequired: true, distributedBy: null,
      status: PurchaseOrderLineStatus.confirmed_partial }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 50 });
    for (const candidate of pending) {
      await this.prisma.$transaction(async tx => {
        const claimed = await tx.purchaseOrderLine.updateMany({ where: { id: candidate.id, distributionRequired: true, distributedBy: null },
          data: { distributedBy: 'system:delivery-ready-fifo-v1' } });
        if (!claimed.count) return;
        const line = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: candidate.id }, include: { allocations: true } });
        await this.supplyPlan.lockOrders(tx, line.allocations.map(link => link.orderId));
        const split = await this.automaticDistribution(tx, line, line.confirmedQuantity ?? 0);
        if (!split) return;
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { distributionRequired: false, distributedAt: new Date(), distributionReason: split.audit } });
        const orderIds = await this.applyToAllocations(tx, line.purchaseOrderId, line.allocations, line.status, line.confirmedQuantity ?? 0, split.quantities);
        await this.recordAdvance(tx, 'purchase_order_line.distributed', line.id, orderIds);
      }, { timeout: 30000 });
      await this.events.dispatchPending({ aggregateId: candidate.id });
    }
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
  /** Staff: every PO line linked to one customer order, with the order's own quantities on it. */
  async listLinesForOrder(orderId: string) {
    const links = await this.prisma.purchaseOrderLineAllocation.findMany({
      where: { orderId }, orderBy: { createdAt: 'asc' },
      include: { shortfalls: true, line: { include: { purchaseOrder: { select: { id: true, status: true, supplierId: true, batchRef: true, readyAt: true, receivedAt: true } } } } },
    });
    return links.map(link => ({
      purchaseOrderId: link.line.purchaseOrder.id, purchaseOrderStatus: link.line.purchaseOrder.status,
      supplierId: link.line.purchaseOrder.supplierId, batchRef: link.line.purchaseOrder.batchRef,
      readyAt: link.line.purchaseOrder.readyAt, lineId: link.line.id, lineStatus: link.line.status, skuId: link.line.skuId,
      orderItemId: link.orderItemId, quantity: link.quantity, confirmedQuantity: link.confirmedQuantity,
      receivedQuantity: link.receivedQuantity, shortQuantity: link.shortQuantity,
      unitCost: link.line.unitCost === null ? null : Number(link.line.unitCost),
      exceptionCode: link.line.exceptionCode, distributionRequired: link.line.distributionRequired,
      shortfalls: link.shortfalls.map(s => ({ quantity: s.quantity, reasonCode: s.reasonCode, createdAt: s.createdAt })),
    }));
  }

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

}
