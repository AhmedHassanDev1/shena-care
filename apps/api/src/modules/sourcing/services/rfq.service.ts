import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';
import { Prisma, PurchaseOrderLineStatus, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { DomainEventsService } from '../../../platform/events/domain-events.service';
import { CatalogService } from '../../catalog/public';
import { SupportService } from '../../operations/services/support.service';
import { getProcurementBatchConfig, getSourcingMode, getSupplierResponseMinutes, isBroadcastMode } from '../config/procurement-batch.config';
import { RespondToRfqDto } from '../dto/rfq.dto';
import { allocateScarceQuantity, committedDeliveryDeadline } from './procurement-policy';
import { canSupplierReceiveOrder, isDemandDueForCheckpoint, supplierResponseDeadline } from './supplier-schedule';

type Db = Prisma.TransactionClient | PrismaService;
type Tx = Prisma.TransactionClient;

export const RFQ_SCHEDULER_ACTOR = 'system:rfq-schedule';
const RFQ_BATCH_LOCK = 44091;
const RFQ_EVALUATE_LOCK = 44092;
const ACTIVE_ORDER_STATUSES = ['placed', 'confirmed', 'packing'];
/** Seconds of events re-read on every poll: a lower seq can commit after a higher one, so the cursor alone could skip it. */
const STREAM_LOOKBEHIND_SECONDS = 30;

export interface RfqStreamEvent {
  seq: string;
  rfqId: string;
  type: string;
  createdAt: Date;
  payload: unknown;
}

interface ActiveSource {
  id: string; requirementId: string; orderId: string; orderItemId: string;
  available: number; awarded: number; promisedDate: Date | null; orderCreatedAt: Date;
}

interface LineDemand { remaining: number; sources: ActiveSource[] }

type StaleLine = { demandLineId: string; currentVersion: number; remainingQuantity: number };

@Injectable()
export class RfqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RfqService.name);
  /** Wakes open SSE connections right after a commit; polling the table remains the source of delivery. */
  readonly bus = new EventEmitter();
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
    private readonly support: SupportService,
    private readonly catalog: CatalogService,
  ) {
    this.bus.setMaxListeners(0);
  }

  onModuleInit() {
    this.logger.log(`Sourcing mode: ${getSourcingMode()}`);
    const configured = process.env.RFQ_TICK_MS;
    const interval = configured !== undefined ? Number(configured) : process.env.NODE_ENV === 'test' ? 0 : 60_000;
    if (isBroadcastMode() && interval > 0) {
      this.timer = setInterval(() => {
        if (this.ticking) return;
        this.ticking = true;
        this.flushRfqBatch(RFQ_SCHEDULER_ACTOR).then(() => this.runMaintenance())
          .catch(error => this.logger.error(`RFQ tick failed: ${error.message}`))
          .finally(() => { this.ticking = false; });
      }, interval);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private assertBroadcast() {
    if (!isBroadcastMode()) {
      throw new ConflictException({ code: 'SOURCING_MODE_INACTIVE', message: `RFQ procurement is inactive in sourcing mode ${getSourcingMode()}` });
    }
  }

  private wake() {
    this.bus.emit('wake');
  }

  private async lockOrders(tx: Tx, orderIds: string[]) {
    for (const id of [...new Set(orderIds)].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(44071, hashtext(${id}))::text AS locked`;
  }

  private inScope(supplier: { rfqScopeSkuIds: string[] }, skuId: string) {
    return supplier.rfqScopeSkuIds.length === 0 || supplier.rfqScopeSkuIds.includes(skuId);
  }

  private async emit(tx: Tx, rfqId: string, supplierId: string | null, type: string, actorId: string, payload: Record<string, unknown>, reason?: string) {
    await tx.rfqEvent.create({ data: { rfqId, supplierId, type, actorId, reason: reason ?? null, payload: payload as Prisma.InputJsonValue } });
  }

  /** Remaining demand per line, derived from sources whose requirement and customer order are still active. */
  private async loadDemand(db: Db, lineIds: string[]): Promise<Map<string, LineDemand>> {
    const result = new Map<string, LineDemand>(lineIds.map(id => [id, { remaining: 0, sources: [] }]));
    if (!lineIds.length) return result;
    const sources = await db.rfqDemandSource.findMany({ where: { demandLineId: { in: lineIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    if (!sources.length) return result;
    const [requirements, orders] = await Promise.all([
      db.supplyRequirement.findMany({ where: { id: { in: sources.map(s => s.requirementId) } }, select: { id: true, releasedAt: true } }),
      db.order.findMany({ where: { id: { in: [...new Set(sources.map(s => s.orderId))] } }, select: { id: true, status: true, promisedDate: true, createdAt: true } }),
    ]);
    const released = new Set(requirements.filter(r => r.releasedAt).map(r => r.id));
    const orderById = new Map(orders.map(o => [o.id, o]));
    for (const source of sources) {
      const order = orderById.get(source.orderId);
      const available = source.quantity - source.awardedQuantity;
      if (!order || !ACTIVE_ORDER_STATUSES.includes(order.status) || released.has(source.requirementId) || available <= 0) continue;
      const entry = result.get(source.demandLineId)!;
      entry.remaining += available;
      entry.sources.push({ id: source.id, requirementId: source.requirementId, orderId: source.orderId, orderItemId: source.orderItemId,
        available, awarded: source.awardedQuantity, promisedDate: order.promisedDate, orderCreatedAt: order.createdAt });
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Issue: aggregate pending demand by canonical SKU and broadcast it
  // -------------------------------------------------------------------------

  /**
   * Checkpoint broadcast. Aggregates demand not yet covered (confirmed, pending, or sitting in another open RFQ) by
   * canonical SKU and sends it, as a non-binding RFQ, to every active enrolled supplier whose working window is open
   * and whose scope includes the SKU. No SupplierOffer, stock figure or price is read.
   */
  async flushRfqBatch(actorId: string, options: { now?: Date; early?: boolean; reason?: string; includeClosedSuppliers?: boolean } = {}) {
    this.assertBroadcast();
    const now = options.now ?? new Date();
    const early = options.early ?? actorId !== RFQ_SCHEDULER_ACTOR;
    const timeZone = getProcurementBatchConfig().timeZone;

    const outcome = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RFQ_BATCH_LOCK}::int4, 0::int4)`;
      const requirements = await tx.supplyRequirement.findMany({
        where: { releasedAt: null, actionRequirement: { is: null }, supplyRequest: { status: 'CONFIRMING' } },
        include: { allocations: { select: { result: true, confirmedQuantity: true, allocatedQuantity: true } }, supplyRequest: { select: { orderId: true } } },
        orderBy: { createdAt: 'asc' }, take: 2000,
      });
      if (!requirements.length) return { rfqId: null as string | null, batchRef: null as string | null, lines: 0, recipients: 0, waiting: 0, escalated: 0 };

      const orders = await tx.order.findMany({
        where: { id: { in: [...new Set(requirements.map(r => r.supplyRequest.orderId))] }, status: { in: ACTIVE_ORDER_STATUSES as never[] } },
        select: { id: true },
      });
      const activeOrders = new Set(orders.map(o => o.id));
      const inOpenRfq = await tx.rfqDemandSource.findMany({
        where: { requirementId: { in: requirements.map(r => r.id) }, demandLine: { rfq: { status: 'open' } } },
        select: { requirementId: true, quantity: true, awardedQuantity: true },
      });
      const reserved = new Map<string, number>();
      for (const row of inOpenRfq) reserved.set(row.requirementId, (reserved.get(row.requirementId) ?? 0) + row.quantity - row.awardedQuantity);

      const bySku = new Map<string, Array<{ requirementId: string; orderId: string; orderItemId: string; need: number }>>();
      for (const requirement of requirements) {
        const orderId = requirement.supplyRequest.orderId;
        if (!activeOrders.has(orderId)) continue;
        if (!early && !isDemandDueForCheckpoint(requirement.createdAt, now, timeZone)) continue;
        const covered = requirement.allocations.reduce((sum, a) =>
          sum + (a.result === 'pending' ? a.allocatedQuantity : ['confirmed_full', 'confirmed_partial'].includes(a.result) ? a.confirmedQuantity : 0), 0);
        const need = requirement.requiredQuantity - covered - (reserved.get(requirement.id) ?? 0);
        if (need <= 0) continue;
        bySku.set(requirement.skuId, [...(bySku.get(requirement.skuId) ?? []), { requirementId: requirement.id, orderId, orderItemId: requirement.orderItemId, need }]);
      }
      if (!bySku.size) return { rfqId: null, batchRef: null, lines: 0, recipients: 0, waiting: 0, escalated: 0 };

      const suppliers = await tx.supplier.findMany({ where: { isActive: true, rfqEnrolledAt: { not: null } } });
      const open = suppliers.filter(s => options.includeClosedSuppliers || canSupplierReceiveOrder(now, s, timeZone));
      const keptSkus: string[] = [];
      let waiting = 0;
      const unservable: string[] = [];
      for (const skuId of bySku.keys()) {
        if (!suppliers.some(s => this.inScope(s, skuId))) unservable.push(skuId);
        else if (!open.some(s => this.inScope(s, skuId))) waiting++;
        else keptSkus.push(skuId);
      }

      let escalated = 0;
      for (const skuId of unservable) {
        const demand = bySku.get(skuId)!;
        await this.lockOrders(tx, demand.map(d => d.orderId));
        for (const d of demand) await this.markExhausted(tx, d.requirementId, d.need);
        await this.support.openOperationalException(tx, {
          dedupKey: `rfq-no-supplier:${skuId}:${now.toISOString().slice(0, 10)}`, category: 'sourcing', priority: 'high',
          title: 'No enrolled supplier can receive this SKU',
          description: `SKU ${skuId} has pending demand of ${demand.reduce((s, d) => s + d.need, 0)} unit(s) but no active, enrolled supplier covers it. Enrol a supplier or contact the customer.`,
        });
        await this.events.record(tx, { eventType: 'rfq.exhausted', aggregateType: 'ProcurementRfq', aggregateId: randomUUID(),
          payload: { orderIds: [...new Set(demand.map(d => d.orderId))] } });
        escalated += demand.length;
      }
      if (!keptSkus.length) return { rfqId: null, batchRef: null, lines: 0, recipients: 0, waiting, escalated };

      const batchRef = `RFQ-${randomUUID()}`;
      const rfq = await tx.procurementRfq.create({ data: {
        batchRef, createdBy: actorId, reason: options.reason ?? (early ? 'Early flush' : 'Scheduled checkpoint'),
        lines: { create: keptSkus.map(skuId => {
          const demand = bySku.get(skuId)!;
          return { skuId, requiredQuantity: demand.reduce((s, d) => s + d.need, 0),
            sources: { create: demand.map(d => ({ requirementId: d.requirementId, orderId: d.orderId, orderItemId: d.orderItemId, quantity: d.need })) } };
        }) },
      } });
      const recipients = open.filter(s => keptSkus.some(skuId => this.inScope(s, skuId)));
      for (const supplier of recipients) {
        const deadlineAt = supplierResponseDeadline(now, supplier, getSupplierResponseMinutes(false), timeZone);
        await tx.rfqRecipient.create({ data: { rfqId: rfq.id, supplierId: supplier.id, deadlineAt } });
        await this.emit(tx, rfq.id, supplier.id, 'rfq_issued', actorId, {
          rfqId: rfq.id, batchRef, lineCount: keptSkus.filter(skuId => this.inScope(supplier, skuId)).length, deadlineAt: deadlineAt.toISOString(),
        }, rfq.reason ?? undefined);
      }
      return { rfqId: rfq.id, batchRef, lines: keptSkus.length, recipients: recipients.length, waiting, escalated };
    }, { timeout: 30000 });
    if (outcome.rfqId || outcome.escalated) this.wake();
    return outcome;
  }

  private async markExhausted(tx: Tx, requirementId: string, unresolved: number) {
    await tx.availabilityActionRequirement.upsert({
      where: { requirementId },
      create: { requirementId, category: 'SOURCE_EXHAUSTED', unresolvedQuantity: unresolved },
      update: { unresolvedQuantity: unresolved },
    });
  }

  // -------------------------------------------------------------------------
  // Supplier snapshot (the authoritative view; the browser is never the source of truth)
  // -------------------------------------------------------------------------

  async listForSupplier(supplierId: string) {
    const recipients = await this.prisma.rfqRecipient.findMany({
      where: { supplierId }, orderBy: { createdAt: 'desc' }, take: 30,
      include: { rfq: { include: { lines: true } } },
    });
    const demand = await this.loadDemand(this.prisma, recipients.flatMap(r => r.rfq.lines.map(l => l.id)));
    const supplier = await this.prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    const answered = await this.prisma.rfqResponseLine.findMany({
      where: { supplierId, demandLineId: { in: recipients.flatMap(r => r.rfq.lines.map(l => l.id)) } }, select: { demandLineId: true },
    });
    const answeredIds = new Set(answered.map(a => a.demandLineId));
    return recipients.map(recipient => {
      const lines = recipient.rfq.lines.filter(l => this.inScope(supplier, l.skuId));
      const actionable = recipient.rfq.status === 'open' && recipient.status === 'pending'
        ? lines.filter(l => (demand.get(l.id)?.remaining ?? 0) > 0 && !answeredIds.has(l.id)).length : 0;
      return { rfqId: recipient.rfqId, batchRef: recipient.rfq.batchRef, status: recipient.rfq.status, expedited: recipient.rfq.expedited,
        recipientStatus: recipient.status, deadlineAt: recipient.deadlineAt, createdAt: recipient.rfq.createdAt,
        lineCount: lines.length, actionableLineCount: actionable };
    });
  }

  async getSupplierSnapshot(supplierId: string, rfqId: string, options: { markOpened?: boolean } = {}) {
    const recipient = await this.prisma.rfqRecipient.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId } } });
    if (!recipient) throw new ForbiddenException('This request was not sent to your account');
    if (options.markOpened && !recipient.openedAt) {
      await this.prisma.rfqRecipient.updateMany({ where: { id: recipient.id, openedAt: null }, data: { openedAt: new Date() } });
    }
    const cursor = await this.prisma.rfqEvent.aggregate({ _max: { seq: true } });
    const [rfq, supplier] = await Promise.all([
      this.prisma.procurementRfq.findUniqueOrThrow({ where: { id: rfqId }, include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } }),
      this.prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } }),
    ]);
    const lines = rfq.lines.filter(l => this.inScope(supplier, l.skuId));
    const [demand, mine, labels, orders] = await Promise.all([
      this.loadDemand(this.prisma, lines.map(l => l.id)),
      this.prisma.rfqResponseLine.findMany({ where: { supplierId, demandLineId: { in: lines.map(l => l.id) } } }),
      this.catalog.getSkuLabels(lines.map(l => l.skuId)),
      this.prisma.supplierPurchaseOrder.findMany({
        where: { supplierId, batchRef: rfq.batchRef }, select: { id: true, status: true, issuedAt: true, expedited: true }, orderBy: { createdAt: 'asc' },
      }),
    ]);
    const myAnswer = new Map(mine.map(m => [m.demandLineId, m]));
    const windowOpen = rfq.status === 'open' && recipient.status === 'pending' && recipient.deadlineAt.getTime() > Date.now();
    return {
      rfq: { id: rfq.id, batchRef: rfq.batchRef, status: rfq.status, expedited: rfq.expedited, createdAt: rfq.createdAt },
      recipient: { status: recipient.status, deadlineAt: recipient.deadlineAt },
      cursor: (cursor._max.seq ?? BigInt(0)).toString(),
      lines: lines.map(line => {
        const remaining = demand.get(line.id)?.remaining ?? 0;
        const answer = myAnswer.get(line.id);
        const state = answer ? 'answered'
          : remaining === 0 ? (line.awardedQuantity > 0 ? 'fulfilled_elsewhere' : 'withdrawn')
          : windowOpen ? 'actionable' : 'closed';
        return { demandLineId: line.id, skuId: line.skuId, sku: labels.get(line.skuId) ?? null, originalQuantity: line.requiredQuantity,
          requestedQuantity: remaining, version: line.version, state,
          myAnswer: answer ? { answer: answer.answer, offeredQuantity: answer.offeredQuantity, awardedQuantity: answer.awardedQuantity } : null };
      }),
      purchaseOrders: orders,
    };
  }

  // -------------------------------------------------------------------------
  // Respond: the atomic, versioned, idempotent allocation
  // -------------------------------------------------------------------------

  async respond(supplierId: string, rfqId: string, dto: RespondToRfqDto, actorId: string) {
    const lineIds = dto.lines.map(l => l.demandLineId);
    if (new Set(lineIds).size !== lineIds.length) throw new BadRequestException('Each request line may be answered once per submission');
    for (const line of dto.lines) {
      if (line.answer === 'PARTIAL' && !line.quantity) throw new BadRequestException('A partial answer needs the quantity you can supply');
      if (line.answer !== 'PARTIAL' && line.quantity !== undefined) throw new BadRequestException('Only a partial answer carries a quantity');
      if (line.answer !== 'UNAVAILABLE' && line.seenQuantity === undefined) throw new BadRequestException('FULL and PARTIAL answers must state the requested quantity you saw');
    }
    const requestHash = createHash('sha256').update(JSON.stringify([...dto.lines].sort((a, b) => a.demandLineId.localeCompare(b.demandLineId))
      .map(l => [l.demandLineId, l.answer, l.quantity ?? null, l.basedOnVersion, l.seenQuantity ?? null]))).digest('hex');

    const replay = await this.findReplay(supplierId, rfqId, dto.idempotencyKey, requestHash);
    if (replay) return replay;

    // Order advisory locks first (same order as cancellations: orders -> demand lines), then the line rows.
    const preliminary = await this.prisma.rfqDemandSource.findMany({ where: { demandLineId: { in: lineIds }, demandLine: { rfqId } }, select: { orderId: true } });

    let outcome: Awaited<ReturnType<RfqService['respondInTransaction']>>;
    try {
      outcome = await this.prisma.$transaction(async tx => {
        await this.lockOrders(tx, preliminary.map(s => s.orderId));
        return this.respondInTransaction(tx, supplierId, rfqId, dto, actorId, requestHash);
      }, { timeout: 30000 });
    } catch (error) {
      // A concurrent identical retry won the unique key: replay its stored outcome.
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await this.findReplay(supplierId, rfqId, dto.idempotencyKey, requestHash);
        if (raced) return raced;
        throw new ConflictException({ code: 'ALREADY_ANSWERED', message: 'One or more request lines were already answered by your account' });
      }
      throw error;
    }
    this.wake();
    if (outcome.orderIds.length) this.events.dispatchSoon(outcome.purchaseOrderId!);
    await this.evaluateRfq(rfqId).catch(error => this.logger.error(`RFQ evaluation after response failed: ${error.message}`));
    return outcome.result;
  }

  private async findReplay(supplierId: string, rfqId: string, key: string, hash: string) {
    const existing = await this.prisma.rfqResponse.findUnique({
      where: { rfqId_supplierId_idempotencyKey: { rfqId, supplierId, idempotencyKey: key } }, include: { lines: true },
    });
    if (!existing) return null;
    if (existing.requestHash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This idempotency key was already used with a different answer' });
    const lines = await this.prisma.rfqDemandLine.findMany({ where: { id: { in: existing.lines.map(l => l.demandLineId) } } });
    const demand = await this.loadDemand(this.prisma, lines.map(l => l.id));
    return this.resultOf(existing, existing.lines, lines, demand, true);
  }

  private resultOf(response: { id: string; purchaseOrderId: string | null }, responseLines: Array<{ demandLineId: string; answer: string; offeredQuantity: number; awardedQuantity: number }>,
    lines: Array<{ id: string; skuId: string; version: number }>, demand: Map<string, LineDemand>, replayed: boolean) {
    return {
      responseId: response.id, purchaseOrderId: response.purchaseOrderId, replayed,
      lines: responseLines.map(l => {
        const line = lines.find(x => x.id === l.demandLineId)!;
        return { demandLineId: l.demandLineId, skuId: line.skuId, answer: l.answer, offeredQuantity: l.offeredQuantity,
          awardedQuantity: l.awardedQuantity, version: line.version, remainingQuantity: demand.get(l.demandLineId)?.remaining ?? 0 };
      }),
    };
  }

  private async respondInTransaction(tx: Tx, supplierId: string, rfqId: string, dto: RespondToRfqDto, actorId: string, requestHash: string) {
    const now = new Date();
    const lineIds = dto.lines.map(l => l.demandLineId);
    const rfq = await tx.procurementRfq.findUnique({ where: { id: rfqId } });
    if (!rfq) throw new NotFoundException('Request not found');
    const recipient = await tx.rfqRecipient.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId } }, include: { supplier: true } });
    if (!recipient) throw new ForbiddenException('This request was not sent to your account');
    if (rfq.status !== 'open') throw new ConflictException({ code: 'RFQ_CLOSED', message: 'This request is closed' });
    if (recipient.status === 'timed_out' || recipient.deadlineAt.getTime() <= now.getTime()) {
      throw new ConflictException({ code: 'RESPONSE_WINDOW_EXPIRED', message: 'The response window for this request has ended; the quantities were offered to others' });
    }
    if (!recipient.supplier.isActive || !recipient.supplier.rfqEnrolledAt) throw new ForbiddenException('Supplier is not enrolled to receive requests');

    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM sourcing.rfq_demand_lines WHERE id = ANY(${lineIds}::uuid[]) AND rfq_id = ${rfqId}::uuid ORDER BY id FOR UPDATE`;
    if (locked.length !== lineIds.length) throw new NotFoundException('One or more request lines do not belong to this request');
    const lines = await tx.rfqDemandLine.findMany({ where: { id: { in: lineIds } }, orderBy: { id: 'asc' } });
    for (const line of lines) {
      if (!this.inScope(recipient.supplier, line.skuId)) throw new ForbiddenException('A request line is outside your product scope');
    }
    // A concurrent identical retry that queued behind the first submission replays its stored outcome.
    const duplicate = await tx.rfqResponse.findUnique({
      where: { rfqId_supplierId_idempotencyKey: { rfqId, supplierId, idempotencyKey: dto.idempotencyKey } }, include: { lines: true },
    });
    if (duplicate) {
      if (duplicate.requestHash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This idempotency key was already used with a different answer' });
      const replayDemand = await this.loadDemand(tx, lineIds);
      return { result: this.resultOf(duplicate, duplicate.lines, lines, replayDemand, true), purchaseOrderId: duplicate.purchaseOrderId, orderIds: [] as string[] };
    }
    const answered = await tx.rfqResponseLine.findFirst({ where: { demandLineId: { in: lineIds }, supplierId } });
    if (answered) throw new ConflictException({ code: 'ALREADY_ANSWERED', message: 'One or more request lines were already answered by your account' });

    const demand = await this.loadDemand(tx, lineIds);
    const answerOf = new Map(dto.lines.map(l => [l.demandLineId, l]));
    const stale: StaleLine[] = [];
    for (const line of lines) {
      const answer = answerOf.get(line.id)!;
      if (answer.answer === 'UNAVAILABLE') continue; // never increases procurement, so staleness cannot hurt
      const remaining = demand.get(line.id)!.remaining;
      if (line.version !== answer.basedOnVersion || remaining !== answer.seenQuantity || remaining === 0) {
        stale.push({ demandLineId: line.id, currentVersion: line.version, remainingQuantity: remaining });
      }
    }
    if (stale.length) {
      throw new ConflictException({ code: 'STALE_DEMAND', message: 'Demand changed since you opened this request. Review the updated quantities before confirming.', staleLines: stale });
    }
    for (const line of lines) {
      const answer = answerOf.get(line.id)!;
      if (answer.answer === 'PARTIAL' && answer.quantity! >= demand.get(line.id)!.remaining) {
        throw new BadRequestException('A partial quantity must be below the requested quantity; answer FULL instead');
      }
    }

    const response = await tx.rfqResponse.create({ data: { rfqId, supplierId, idempotencyKey: dto.idempotencyKey, requestHash, createdBy: actorId } });
    const awards: Array<{ lineId: string; skuId: string; quantity: number; portions: Array<{ allocationId: string; orderId: string; orderItemId: string; quantity: number }> }> = [];
    const responseLines: Array<{ demandLineId: string; answer: 'FULL' | 'PARTIAL' | 'UNAVAILABLE'; offeredQuantity: number; awardedQuantity: number }> = [];
    const touchedOrders = new Set<string>();

    for (const line of lines) {
      const answer = answerOf.get(line.id)!;
      const current = demand.get(line.id)!;
      const quantity = answer.answer === 'FULL' ? current.remaining : answer.answer === 'PARTIAL' ? answer.quantity! : 0;
      await tx.rfqResponseLine.create({ data: {
        responseId: response.id, demandLineId: line.id, supplierId, answer: answer.answer,
        offeredQuantity: quantity, awardedQuantity: quantity, basedOnVersion: answer.basedOnVersion,
      } });
      responseLines.push({ demandLineId: line.id, answer: answer.answer, offeredQuantity: quantity, awardedQuantity: quantity });
      if (quantity === 0) continue;

      const split = allocateScarceQuantity(current.sources.map(source => ({
        id: source.id, orderId: source.orderId, quantity: source.available,
        deliveryDeadline: committedDeliveryDeadline(source.promisedDate)?.getTime() ?? Number.MAX_SAFE_INTEGER,
        otherwiseReady: false, orderCreatedAt: source.orderCreatedAt.getTime(),
      })), quantity);
      const portions: Array<{ allocationId: string; orderId: string; orderItemId: string; quantity: number }> = [];
      for (const source of current.sources) {
        const portion = split.get(source.id) ?? 0;
        if (portion <= 0) continue;
        const moved = await tx.rfqDemandSource.updateMany({
          where: { id: source.id, awardedQuantity: source.awarded },
          data: { awardedQuantity: { increment: portion } },
        });
        if (moved.count !== 1) throw new ConflictException({ code: 'DEMAND_CHANGED', message: 'Demand changed while allocating; review and retry' });
        const allocation = await tx.sourceAllocation.create({ data: {
          requirementId: source.requirementId, supplierId, rfqDemandSourceId: source.id,
          requestedQuantity: portion, allocatedQuantity: portion, confirmedQuantity: portion,
          result: 'confirmed_full', reportedResult: 'confirmed_full', reportedQuantity: portion, confirmedAt: now, evidenceRef: `RFQ:${rfqId}`.slice(0, 255),
        } });
        portions.push({ allocationId: allocation.id, orderId: source.orderId, orderItemId: source.orderItemId, quantity: portion });
        touchedOrders.add(source.orderId);
      }
      awards.push({ lineId: line.id, skuId: line.skuId, quantity, portions });

      const updated = await tx.rfqDemandLine.update({ where: { id: line.id }, data: { awardedQuantity: { increment: quantity }, version: { increment: 1 } } });
      await this.emit(tx, rfqId, null, 'demand_changed', actorId, {
        rfqId, demandLineId: line.id, skuId: line.skuId, previousQuantity: current.remaining, remainingQuantity: current.remaining - quantity,
        version: updated.version, reason: 'DEMAND_AWARDED',
      }, 'Allocation accepted for a supplier');
    }

    let purchaseOrderId: string | null = null;
    if (awards.length) {
      const po = await tx.supplierPurchaseOrder.create({ data: {
        supplierId, status: PurchaseOrderStatus.confirmed, batchRef: rfq.batchRef, issuedAt: now, confirmedAt: now, expedited: rfq.expedited,
        notes: `RFQ ${rfq.batchRef}: allocation accepted for ${actorId}`,
        lines: { create: awards.map(award => ({
          skuId: award.skuId, requestedQuantity: award.quantity, confirmedQuantity: award.quantity, status: PurchaseOrderLineStatus.confirmed_full,
          allocations: { create: award.portions.map(p => ({
            sourceAllocationId: p.allocationId, orderId: p.orderId, orderItemId: p.orderItemId, quantity: p.quantity, confirmedQuantity: p.quantity,
          })) },
        })) },
      } });
      purchaseOrderId = po.id;
      await tx.rfqResponse.update({ where: { id: response.id }, data: { purchaseOrderId: po.id } });
      await this.events.record(tx, { eventType: 'purchase_order.confirmed', aggregateType: 'PurchaseOrder', aggregateId: po.id, payload: { orderIds: [...touchedOrders] } });
      await this.emit(tx, rfqId, supplierId, 'allocation_accepted', actorId, {
        rfqId, purchaseOrderId: po.id, lines: awards.map(a => ({ demandLineId: a.lineId, skuId: a.skuId, quantity: a.quantity })),
      });
    }
    await this.emit(tx, rfqId, supplierId, 'response_recorded', actorId, {
      rfqId, responseId: response.id, answers: responseLines.map(l => ({ demandLineId: l.demandLineId, answer: l.answer, awarded: l.awardedQuantity })),
    });
    await this.refreshRecipient(tx, rfqId, supplierId, recipient.supplier);

    const after = await this.loadDemand(tx, lines.map(l => l.id));
    const fresh = await tx.rfqDemandLine.findMany({ where: { id: { in: lineIds } } });
    const result = this.resultOf({ id: response.id, purchaseOrderId }, responseLines, fresh, after, false);
    return { result, purchaseOrderId, orderIds: [...touchedOrders] };
  }

  /** A recipient has "responded" once every in-scope line is answered by it or has no remaining demand. */
  private async refreshRecipient(tx: Tx, rfqId: string, supplierId: string, supplier: { rfqScopeSkuIds: string[] }) {
    const lines = (await tx.rfqDemandLine.findMany({ where: { rfqId } })).filter(l => this.inScope(supplier, l.skuId));
    const [demand, mine] = await Promise.all([
      this.loadDemand(tx, lines.map(l => l.id)),
      tx.rfqResponseLine.findMany({ where: { supplierId, demandLineId: { in: lines.map(l => l.id) } }, select: { demandLineId: true } }),
    ]);
    const answered = new Set(mine.map(m => m.demandLineId));
    if (lines.every(l => answered.has(l.id) || (demand.get(l.id)?.remaining ?? 0) === 0)) {
      await tx.rfqRecipient.updateMany({ where: { rfqId, supplierId, status: 'pending' }, data: { status: 'responded', respondedAt: new Date() } });
    }
  }

  // -------------------------------------------------------------------------
  // Recovery: expedite the unmet remainder, escalate only when automation is exhausted
  // -------------------------------------------------------------------------

  /** Periodic pass over open RFQs: timeouts, withdrawn demand, expedited audience extension, Admin escalation. */
  async runMaintenance(now = new Date()) {
    const open = await this.prisma.procurementRfq.findMany({ where: { status: 'open' }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 100 });
    for (const rfq of open) await this.evaluateRfq(rfq.id, now);
    return open.length;
  }

  async evaluateRfq(rfqId: string, now = new Date()): Promise<'noop' | 'closed' | 'extended' | 'waiting' | 'escalated'> {
    const timeZone = getProcurementBatchConfig().timeZone;
    const outcome = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RFQ_EVALUATE_LOCK}::int4, hashtext(${rfqId}))`;
      const rfq = await tx.procurementRfq.findUnique({ where: { id: rfqId }, include: { lines: true, recipients: { include: { supplier: true } } } });
      if (!rfq || rfq.status !== 'open') return { result: 'noop' as const, orderIds: [] as string[] };

      // Stage 1 (unlocked): which orders could be affected. Stage 2 re-reads under their locks.
      const sources = await tx.rfqDemandSource.findMany({ where: { demandLineId: { in: rfq.lines.map(l => l.id) } }, select: { orderId: true } });
      await this.lockOrders(tx, sources.map(s => s.orderId));
      const demand = await this.loadDemand(tx, rfq.lines.map(l => l.id));
      const totalRemaining = [...demand.values()].reduce((sum, d) => sum + d.remaining, 0);
      if (totalRemaining === 0) {
        const awarded = rfq.lines.reduce((sum, l) => sum + l.awardedQuantity, 0);
        await this.closeRfq(tx, rfq.id, awarded > 0 ? 'fulfilled' : 'closed', awarded > 0 ? 'FULFILLED' : 'DEMAND_WITHDRAWN');
        return { result: 'closed' as const, orderIds: [] };
      }

      let timedOut = 0;
      for (const recipient of rfq.recipients.filter(r => r.status === 'pending')) {
        const unavailable = !recipient.supplier.isActive || !recipient.supplier.rfqEnrolledAt;
        if (recipient.deadlineAt.getTime() > now.getTime() && !unavailable) continue;
        await tx.rfqRecipient.update({ where: { id: recipient.id }, data: { status: 'timed_out', respondedAt: now } });
        await this.emit(tx, rfq.id, recipient.supplierId, 'recipient_timed_out', 'system:rfq-maintenance',
          { rfqId: rfq.id, reason: unavailable ? 'SUPPLIER_UNAVAILABLE' : 'NO_RESPONSE' }, unavailable ? 'Supplier unavailable' : 'No response before the deadline');
        timedOut++;
      }
      const responses = await tx.rfqResponseLine.findMany({ where: { demandLineId: { in: rfq.lines.map(l => l.id) } } });
      const shortage = timedOut > 0 || rfq.recipients.some(r => r.status === 'timed_out') ||
        responses.some(r => r.answer !== 'FULL' && (demand.get(r.demandLineId)?.remaining ?? 0) > 0);

      let added = 0;
      if (shortage) {
        const known = new Set(rfq.recipients.map(r => r.supplierId));
        const remainingSkus = rfq.lines.filter(l => (demand.get(l.id)?.remaining ?? 0) > 0).map(l => l.skuId);
        const candidates = await tx.supplier.findMany({ where: { isActive: true, rfqEnrolledAt: { not: null }, id: { notIn: [...known] } } });
        for (const supplier of candidates) {
          if (!canSupplierReceiveOrder(now, supplier, timeZone) || !remainingSkus.some(skuId => this.inScope(supplier, skuId))) continue;
          const deadlineAt = supplierResponseDeadline(now, supplier, getSupplierResponseMinutes(true), timeZone);
          await tx.rfqRecipient.create({ data: { rfqId: rfq.id, supplierId: supplier.id, deadlineAt, addedReason: 'RECOVERY' } });
          await this.emit(tx, rfq.id, supplier.id, 'rfq_issued', 'system:rfq-maintenance', {
            rfqId: rfq.id, batchRef: rfq.batchRef, lineCount: remainingSkus.filter(skuId => this.inScope(supplier, skuId)).length,
            deadlineAt: deadlineAt.toISOString(), expedited: true,
          }, 'Expedited recovery of unmet demand');
          added++;
        }
        if (added) await tx.procurementRfq.update({ where: { id: rfq.id }, data: { expedited: true } });
      }
      if (added) return { result: 'extended' as const, orderIds: [] };

      const stillPending = await tx.rfqRecipient.count({ where: { rfqId: rfq.id, status: 'pending' } });
      if (stillPending > 0) return { result: 'waiting' as const, orderIds: [] };

      // Every eligible supplier answered or timed out and demand remains: last-resort escalation.
      const orderIds = new Set<string>();
      const attempted = rfq.recipients.length;
      for (const line of rfq.lines) {
        for (const source of demand.get(line.id)?.sources ?? []) {
          const requirement = await tx.supplyRequirement.findUniqueOrThrow({ where: { id: source.requirementId }, include: { allocations: true } });
          const covered = requirement.allocations.reduce((sum, a) => sum + a.confirmedQuantity, 0);
          await this.markExhausted(tx, requirement.id, requirement.requiredQuantity - covered);
          orderIds.add(source.orderId);
        }
        if ((demand.get(line.id)?.remaining ?? 0) > 0) {
          await this.support.openOperationalException(tx, {
            dedupKey: `rfq-exhausted:${rfq.id}:${line.skuId}`, category: 'sourcing', priority: 'high',
            title: `Supply request unmet: ${demand.get(line.id)!.remaining} unit(s) of one SKU`,
            description: `RFQ ${rfq.batchRef}, SKU ${line.skuId}: ${demand.get(line.id)!.remaining} unit(s) remain after ${attempted} supplier(s) answered or timed out. Automated expedited recovery found no further eligible supplier.`,
          });
        }
      }
      await this.closeRfq(tx, rfq.id, 'exhausted', 'NO_ELIGIBLE_SUPPLIER_LEFT');
      await this.events.record(tx, { eventType: 'rfq.exhausted', aggregateType: 'ProcurementRfq', aggregateId: rfq.id, payload: { orderIds: [...orderIds] } });
      return { result: 'escalated' as const, orderIds: [...orderIds] };
    }, { timeout: 30000 });
    if (outcome.result !== 'noop') this.wake();
    if (outcome.result === 'escalated') this.events.dispatchSoon(rfqId);
    return outcome.result;
  }

  private async closeRfq(tx: Tx, rfqId: string, status: 'fulfilled' | 'exhausted' | 'closed', reason: string) {
    await tx.procurementRfq.update({ where: { id: rfqId }, data: { status, closedAt: new Date(), closeReason: reason } });
    await this.emit(tx, rfqId, null, 'rfq_closed', 'system:rfq-maintenance', { rfqId, status, reason }, reason);
  }

  /**
   * Called inside an order cancellation / amendment transaction after its requirements were released: open RFQs show the
   * smaller demand immediately and any in-flight answer built on the old quantity is refused as stale.
   */
  async touchForRequirements(tx: Tx, requirementIds: string[], actorId = 'system:order-change') {
    if (!requirementIds.length) return;
    const sources = await tx.rfqDemandSource.findMany({
      where: { requirementId: { in: requirementIds }, demandLine: { rfq: { status: 'open' } } },
      select: { demandLineId: true, demandLine: { select: { rfqId: true, skuId: true } } },
    });
    const lineIds = [...new Set(sources.map(s => s.demandLineId))].sort();
    if (!lineIds.length) return;
    await tx.$queryRaw`SELECT id FROM sourcing.rfq_demand_lines WHERE id = ANY(${lineIds}::uuid[]) ORDER BY id FOR UPDATE`;
    const demand = await this.loadDemand(tx, lineIds);
    for (const lineId of lineIds) {
      const meta = sources.find(s => s.demandLineId === lineId)!.demandLine;
      const line = await tx.rfqDemandLine.update({ where: { id: lineId }, data: { version: { increment: 1 } } });
      await this.emit(tx, meta.rfqId, null, 'demand_changed', actorId, {
        rfqId: meta.rfqId, demandLineId: lineId, skuId: meta.skuId, remainingQuantity: demand.get(lineId)!.remaining,
        version: line.version, reason: 'ORDER_CHANGED',
      }, 'A customer order changed');
    }
    this.wake();
  }

  // -------------------------------------------------------------------------
  // Real-time stream (SSE source) and staff views
  // -------------------------------------------------------------------------

  /** Events for one supplier after `cursor`, plus a short look-behind (dedupe by seq on the caller's side). */
  async eventsForSupplier(supplierId: string, cursor: bigint): Promise<RfqStreamEvent[]> {
    const rows = await this.prisma.$queryRaw<Array<{ seq: bigint; rfq_id: string; type: string; created_at: Date; payload: unknown }>>`
      SELECT e.seq, e.rfq_id, e.type, e.created_at, e.payload
      FROM sourcing.rfq_events e
      WHERE (e.seq > ${cursor} OR e.created_at > NOW() - make_interval(secs => ${STREAM_LOOKBEHIND_SECONDS}))
        AND (e.supplier_id = ${supplierId}::uuid OR (e.supplier_id IS NULL AND EXISTS (
          SELECT 1 FROM sourcing.rfq_recipients r WHERE r.rfq_id = e.rfq_id AND r.supplier_id = ${supplierId}::uuid)))
      ORDER BY e.seq ASC LIMIT 500`;
    return rows.map(row => ({ seq: row.seq.toString(), rfqId: row.rfq_id, type: row.type, createdAt: row.created_at, payload: row.payload }));
  }

  async currentCursor(): Promise<bigint> {
    return (await this.prisma.rfqEvent.aggregate({ _max: { seq: true } }))._max.seq ?? BigInt(0);
  }

  async listForStaff(paging: { take: number; skip: number }) {
    const [total, items] = await Promise.all([
      this.prisma.procurementRfq.count(),
      this.prisma.procurementRfq.findMany({ orderBy: { createdAt: 'desc' }, take: paging.take, skip: paging.skip,
        include: { lines: true, recipients: true } }),
    ]);
    return { mode: getSourcingMode(), total, items: items.map(rfq => ({
      id: rfq.id, batchRef: rfq.batchRef, status: rfq.status, expedited: rfq.expedited, createdBy: rfq.createdBy, reason: rfq.reason,
      closeReason: rfq.closeReason, createdAt: rfq.createdAt, closedAt: rfq.closedAt,
      lineCount: rfq.lines.length, requiredQuantity: rfq.lines.reduce((s, l) => s + l.requiredQuantity, 0),
      awardedQuantity: rfq.lines.reduce((s, l) => s + l.awardedQuantity, 0),
      recipients: { total: rfq.recipients.length, pending: rfq.recipients.filter(r => r.status === 'pending').length,
        responded: rfq.recipients.filter(r => r.status === 'responded').length, timedOut: rfq.recipients.filter(r => r.status === 'timed_out').length },
    })) };
  }

  /** Staff audit view: lineage and the full append-only trail (suppliers never see this). */
  async getStaffDetail(rfqId: string) {
    const rfq = await this.prisma.procurementRfq.findUnique({ where: { id: rfqId }, include: {
      lines: { include: { sources: true, responseLines: true } }, recipients: true, responses: true,
    } });
    if (!rfq) throw new NotFoundException('Request not found');
    const events = await this.prisma.rfqEvent.findMany({ where: { rfqId }, orderBy: { seq: 'asc' }, take: 1000 });
    const demand = await this.loadDemand(this.prisma, rfq.lines.map(l => l.id));
    return { ...rfq, lines: rfq.lines.map(l => ({ ...l, remainingQuantity: demand.get(l.id)?.remaining ?? 0 })),
      events: events.map(e => ({ ...e, seq: e.seq.toString() })) };
  }
}
