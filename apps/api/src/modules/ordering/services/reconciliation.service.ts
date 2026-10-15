import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SettlementStatus, OrderResolutionType, OrderResolutionStatus, Prisma, RefundStatus } from '@prisma/client';
import { OutboxService } from '../../operations/services/outbox.service';
import { assertClaimableQuantity } from './resolution-claims';

// Resolution and refund lifecycles only move forward; rejected/resolved/succeeded/failed are final.
const RESOLUTION_TRANSITIONS: Record<OrderResolutionStatus, OrderResolutionStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['in_transit', 'received', 'resolved', 'rejected'],
  in_transit: ['received'],
  received: ['resolved'],
  rejected: [],
  resolved: [],
};
const REFUND_TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  pending: ['processing', 'succeeded', 'failed'],
  processing: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
};

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  private isUuid(id: string) {
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    return uuidRegex.test(id);
  }

  // --- GLO-127: Order Resolution (Cancellation/Return) ---
  
  async createResolution(dto: {
    orderId: string;
    type: OrderResolutionType;
    actorId: string;
    reasonCode?: string;
    notes?: string;
    items?: { orderItemId: string; quantity: number }[];
  }) {
    if (!this.isUuid(dto.orderId)) throw new BadRequestException('Invalid order ID');

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
        include: { items: true }
      });

      if (!order) throw new NotFoundException('Order not found');
      const itemIds = (dto.items ?? []).map(i => i.orderItemId);
      if (new Set(itemIds).size !== itemIds.length) throw new BadRequestException('Each order item may appear only once');
      for (const item of dto.items ?? []) {
        await assertClaimableQuantity(tx, order.id, item.orderItemId, item.quantity);
      }

      // Create resolution
      const resolution = await tx.orderResolution.create({
        data: {
          orderId: dto.orderId,
          type: dto.type,
          actorId: dto.actorId,
          reasonCode: dto.reasonCode,
          notes: dto.notes,
          status: 'requested',
          items: dto.items?.length ? {
            create: dto.items.map(i => ({
              orderItemId: i.orderItemId,
              quantity: i.quantity
            }))
          } : undefined
        }
      });

      // Emit event
      await tx.orderResolutionEvent.create({
        data: {
          resolutionId: resolution.id,
          status: 'requested',
          actorId: dto.actorId,
          notes: 'Resolution requested'
        }
      });

      return resolution;
    });
  }

  async updateResolutionStatus(resolutionId: string, status: OrderResolutionStatus, actorId: string, notes?: string) {
    if (!this.isUuid(resolutionId)) throw new BadRequestException('Invalid resolution ID');

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.orderResolution.findUnique({ where: { id: resolutionId } });
      if (!current) throw new NotFoundException('Resolution not found');
      if (current.status === status) return current;
      if (!RESOLUTION_TRANSITIONS[current.status].includes(status)) {
        throw new ConflictException(`Resolution cannot move from ${current.status} to ${status}`);
      }
      const claimed = await tx.orderResolution.updateMany({ where: { id: resolutionId, status: current.status }, data: { status } });
      if (claimed.count !== 1) throw new ConflictException('Resolution changed concurrently; retry');
      const resolution = await tx.orderResolution.findUniqueOrThrow({ where: { id: resolutionId } });

      await tx.orderResolutionEvent.create({
        data: {
          resolutionId,
          status,
          actorId,
          notes
        }
      });

      if (status === 'approved' || status === 'rejected' || status === 'resolved') {
        const order = await tx.order.findUnique({ where: { id: resolution.orderId } });
        if (order) {
          await this.outbox.enqueue(tx, {
            eventType: 'resolution.updated',
            aggregateId: resolution.id,
            aggregateType: 'OrderResolution',
            customerId: order.customerId || undefined,
            payload: { orderId: order.id, orderNumber: order.orderNumber, resolutionId: resolution.id, status },
            channelIntent: 'whatsapp',
            templateId: 'resolution_update_v1',
            deduplicationKey: `resolution.updated:${resolution.id}:${status}`,
          });
        }
      }

      return resolution;
    });
  }

  // --- Advanced Refund Tracking ---
  
  async initiateRefund(resolutionId: string, amount: number, currency: string, paymentProvider?: string) {
    if (!this.isUuid(resolutionId)) throw new BadRequestException('Invalid resolution ID');

    return this.prisma.$transaction(async (tx) => {
      const resolution = await tx.orderResolution.findUnique({
        where: { id: resolutionId },
        include: { order: true },
      });

      if (!resolution) throw new NotFoundException('Resolution not found');
      if (resolution.status === 'requested' || resolution.status === 'rejected') {
        throw new BadRequestException(`Cannot refund a ${resolution.status} resolution`);
      }

      const existingRefund = await tx.refundTransaction.findUnique({
        where: { resolutionId }
      });
      if (existingRefund) throw new BadRequestException('Refund already initiated for this resolution');

      // A refund is in the order currency and, with every other live refund, never exceeds the money
      // actually received: for COD that is the cash counted at the hub (or declared, before counting),
      // never the order total of an unpaid order (GLO-240).
      const requested = new Prisma.Decimal(amount);
      if (!requested.greaterThan(0)) throw new BadRequestException('Refund amount must be positive');
      if (currency !== resolution.order.currency) throw new BadRequestException(`Refunds for this order are in ${resolution.order.currency}`);
      await tx.$queryRaw`SELECT id FROM "ordering"."orders" WHERE id = ${resolution.orderId}::uuid FOR UPDATE`;
      const collection = await tx.paymentCollection.findUnique({ where: { orderId: resolution.orderId } });
      const onlinePaid = resolution.order.paymentMethod !== 'COD'
        ? (await tx.paymentAttempt.findFirst({ where: { orderId: resolution.orderId, status: 'confirmed' } }))?.amount ?? null : null;
      // The refund follows the capture channel: online-confirmed amount, or COD cash actually received.
      const received = resolution.order.paymentMethod !== 'COD' ? onlinePaid : !collection ? null
        : collection.settlementBatchId && collection.collectedAmount ? collection.collectedAmount
        : collection.status === 'collected' ? collection.declaredAmount : null;
      if (!received || !received.greaterThan(0)) {
        throw new ConflictException({ code: 'NO_CASH_RECEIVED', message: 'No customer cash was received for this order; nothing to refund' });
      }
      const others = await tx.refundTransaction.aggregate({
        where: { orderId: resolution.orderId, status: { not: 'failed' } }, _sum: { amount: true },
      });
      const refundable = Prisma.Decimal.min(received, resolution.order.totalAmount).minus(others._sum.amount ?? 0);
      if (requested.greaterThan(refundable)) {
        throw new BadRequestException(`Refund exceeds the refundable balance of ${refundable.toFixed(2)} ${resolution.order.currency}`);
      }

      return tx.refundTransaction.create({
        data: {
          resolutionId,
          orderId: resolution.orderId,
          amount,
          currency,
          status: 'pending',
          paymentProvider
        }
      });
    });
  }

  async updateRefundStatus(resolutionId: string, status: RefundStatus, providerRef?: string, errorReason?: string) {
    if (!this.isUuid(resolutionId)) throw new BadRequestException('Invalid resolution ID');

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.refundTransaction.findUnique({ where: { resolutionId } });
      if (!current) throw new NotFoundException('Refund not found');
      // Manual COD refunds: "paid" needs the operator's proof (voucher/transfer reference), a failure its reason.
      if (status === 'succeeded' && !(providerRef ?? current.providerRef)?.trim()) {
        throw new BadRequestException({ code: 'REFUND_PROOF_REQUIRED', message: 'Record the payout reference to mark a refund paid' });
      }
      if (status === 'failed' && !errorReason?.trim()) throw new BadRequestException('Record why the refund failed');
      if (current.status === status) return tx.refundTransaction.findUniqueOrThrow({ where: { resolutionId }, include: { resolution: { include: { order: true } } } });
      if (current.status !== status && !REFUND_TRANSITIONS[current.status].includes(status)) {
        throw new ConflictException(`Refund cannot move from ${current.status} to ${status}`);
      }
      const claimed = await tx.refundTransaction.updateMany({ where: { resolutionId, status: current.status }, data: { status } });
      if (claimed.count !== 1) throw new ConflictException('Refund changed concurrently; retry');
      const refund = await tx.refundTransaction.update({
        where: { resolutionId },
        data: {
          status,
          ...(providerRef !== undefined ? { providerRef } : {}),
          ...(errorReason !== undefined ? { errorReason } : {}),
        },
        include: { resolution: { include: { order: true } } }
      });

      if (current.status !== status && (status === 'succeeded' || status === 'failed')) {
        await this.outbox.enqueue(tx, {
          eventType: 'refund.updated',
          aggregateId: refund.id,
          aggregateType: 'RefundTransaction',
          customerId: refund.resolution.order.customerId || undefined,
          payload: { 
            orderId: refund.orderId, 
            orderNumber: refund.resolution.order.orderNumber, 
            refundId: refund.id, 
            status 
          },
          channelIntent: 'email',
          templateId: 'refund_update_v1',
          deduplicationKey: `refund.updated:${refund.id}:${status}`,
        });
      }

      return refund;
    });
  }

  // --- GLO-128: COD Settlement Reconciliation ---

  /**
   * Expected COD cash comes from the order, never from the caller, and this endpoint never rewrites
   * it: an existing collection (possibly revised by an availability amendment) is returned as-is,
   * and a caller whose figure disagrees gets a conflict instead of an overwrite.
   */
  async initializePaymentCollection(orderId: string, amount: Prisma.Decimal | number, currency: string) {
    if (!this.isUuid(orderId)) throw new BadRequestException('Invalid order ID');
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const existing = await this.prisma.paymentCollection.findUnique({ where: { orderId } });
    if (existing) {
      if (!existing.expectedAmount.equals(amount) || existing.currency !== currency) {
        throw new ConflictException('Payment collection already recorded with a different amount');
      }
      return existing;
    }
    if (order.status === 'cancelled') throw new BadRequestException('Cancelled orders have no COD collection');
    const expected = order.codAmount ?? order.totalAmount;
    if (!expected.equals(amount) || currency !== order.currency) {
      throw new BadRequestException('COD amount and currency must equal the order COD amount');
    }
    try {
      return await this.prisma.paymentCollection.create({
        data: { orderId, expectedAmount: expected, currency: order.currency, status: 'expected' },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.paymentCollection.findUniqueOrThrow({ where: { orderId } });
      }
      throw error;
    }
  }

  /**
   * The expected COD cash for an order leaving the hub (GLO-214): created once from the order's own
   * COD figure, never from a caller. Returns null for cancelled or fully prepaid orders.
   */
  async ensureExpectedCollection(orderId: string, tx?: Prisma.TransactionClient, locationId?: string | null) {
    const db = tx ?? this.prisma;
    const existing = await db.paymentCollection.findUnique({ where: { orderId } });
    if (existing) {
      // The dispatching hub is recorded once, the first time cash leaves with a run.
      if (locationId && !existing.locationId) {
        await db.paymentCollection.updateMany({ where: { id: existing.id, locationId: null }, data: { locationId } });
        return db.paymentCollection.findUniqueOrThrow({ where: { orderId } });
      }
      return existing;
    }
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'cancelled') return null;
    if (order.paymentMethod !== 'COD') return null; // card/wallet orders never create driver cash (GLO-241)
    const expected = order.codAmount ?? order.totalAmount;
    if (expected.lessThanOrEqualTo(0)) return null;
    // ON CONFLICT: safe for concurrent creators and never aborts the caller's transaction.
    await db.$executeRaw`
      INSERT INTO "ordering"."payment_collections" (id, order_id, expected_amount, currency, status, location_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${orderId}::uuid, ${expected}, ${order.currency}, 'expected', ${locationId ?? null}::uuid, NOW(), NOW())
      ON CONFLICT (order_id) DO NOTHING`;
    return db.paymentCollection.findUniqueOrThrow({ where: { orderId } });
  }

  /**
   * The delivering driver's cash declaration at the door: custody, not settlement (GLO-214). Recorded
   * once — a replay with the same amount by the same driver returns it, anything else conflicts. The
   * hub-counted collectedAmount and short/over status are set only at settlement; tolerance is policy.
   */
  async recordDriverDeclaration(orderId: string, driverId: string, amount: number, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const collection = await this.ensureExpectedCollection(orderId, tx);
    if (!collection) throw new BadRequestException('This order has no cash to collect');
    const declared = new Prisma.Decimal(amount);
    const isReplay = (c: { declaredAmount: Prisma.Decimal | null; courierId: string | null }) =>
      c.declaredAmount !== null && c.declaredAmount.equals(declared) && c.courierId === driverId;

    if (collection.declaredAmount !== null) {
      if (isReplay(collection)) return collection;
      throw new ConflictException('Collected cash was already declared for this order');
    }
    const claimed = await db.paymentCollection.updateMany({
      where: { id: collection.id, declaredAmount: null, status: 'expected', settlementBatchId: null },
      data: { declaredAmount: declared, declaredAt: new Date(), courierId: driverId, status: 'collected' },
    });
    const current = await db.paymentCollection.findUniqueOrThrow({ where: { id: collection.id } });
    if (claimed.count !== 1 && !isReplay(current)) {
      throw new ConflictException('Collected cash was already declared or settled for this order');
    }
    return current;
  }

  /**
   * The order will not be paid at the door any more (cancelled before custody, or returned
   * undelivered): an undeclared expectation is voided, never deleted. Declared or counted cash is a
   * fact that cannot be voided here (GLO-240).
   */
  async voidExpectedCollection(tx: Prisma.TransactionClient, orderId: string) {
    const collection = await tx.paymentCollection.findUnique({ where: { orderId } });
    if (!collection || collection.status === 'voided') return collection;
    if (collection.status !== 'expected' || collection.declaredAmount !== null) {
      throw new ConflictException({ code: 'CASH_ALREADY_COLLECTED', message: 'Cash was already declared for this order' });
    }
    await tx.paymentCollection.update({ where: { id: collection.id }, data: { status: 'voided' } });
    return tx.paymentCollection.findUniqueOrThrow({ where: { orderId } });
  }

  /** Driver-declared cash per order, for the driver's own custody view. */
  async getDeclaredCash(orderIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.paymentCollection.findMany({
      where: { orderId: { in: orderIds }, declaredAmount: { not: null } },
      select: { orderId: true, declaredAmount: true },
    });
    return new Map(rows.map((r) => [r.orderId, Number(r.declaredAmount)]));
  }

  /**
   * The cashier's physical count of one driver's declared cash at one hub (GLO-238). Every line must
   * be a delivered order whose cash that same driver declared on a run of that hub; counted amounts
   * are exact Decimal and the variance against expected is explicit (short/over). A reference is
   * idempotent: the same submission returns the original batch, anything else conflicts.
   */
  async createSettlementBatch(dto: {
    courierId: string;
    locationId: string;
    reference: string;
    totalCollected: number;
    fees?: number;
    currency: string;
    actorId: string;
    notes?: string;
    collections: { orderId: string; collectedAmount: number }[];
  }, allowedLocationIds: string[] | 'all') {
    if (allowedLocationIds !== 'all' && !allowedLocationIds.includes(dto.locationId)) {
      throw new ForbiddenException('Operator is not assigned to this hub');
    }
    // Money is exact Decimal arithmetic; the declared total must match the line items.
    const fees = new Prisma.Decimal(dto.fees ?? 0);
    const totalCollected = new Prisma.Decimal(dto.totalCollected);
    const orderIds = dto.collections.map(c => c.orderId);
    if (new Set(orderIds).size !== orderIds.length) throw new BadRequestException('Each order may appear only once per settlement');
    const lineTotal = dto.collections.reduce((sum, c) => sum.plus(c.collectedAmount), new Prisma.Decimal(0));
    if (!lineTotal.equals(totalCollected)) throw new BadRequestException('totalCollected must equal the sum of collected amounts');
    if (fees.greaterThan(totalCollected)) throw new BadRequestException('Fees cannot exceed the collected total');

    const replay = async () => {
      const prior = await this.prisma.courierSettlementBatch.findUnique({ where: { reference: dto.reference }, include: { collections: true } });
      if (!prior) return null;
      const counted = new Map(prior.collections.map(c => [c.orderId, c.collectedAmount]));
      const same = prior.courierId === dto.courierId && prior.locationId === dto.locationId && prior.currency === dto.currency &&
        prior.totalCollected.equals(totalCollected) && prior.fees.equals(fees) && prior.collections.length === dto.collections.length &&
        dto.collections.every(c => counted.get(c.orderId)?.equals(c.collectedAmount));
      if (!same) throw new ConflictException({ code: 'SETTLEMENT_REFERENCE_REUSED', message: 'Settlement reference was used for a different count' });
      return this.getSettlementBatch(prior.id);
    };
    const prior = await replay();
    if (prior) return prior;

    let batchId: string;
    try {
      batchId = await this.prisma.$transaction(async (tx) => {
        let totalExpected = new Prisma.Decimal(0);
        const batch = await tx.courierSettlementBatch.create({
          data: {
            reference: dto.reference,
            courierId: dto.courierId,
            locationId: dto.locationId,
            totalExpected: 0, // Computed below
            totalCollected,
            fees,
            netSettled: totalCollected.minus(fees),
            currency: dto.currency,
            actorId: dto.actorId,
            notes: dto.notes
          }
        });

        for (const colDto of dto.collections) {
          const collection = await tx.paymentCollection.findUnique({ where: { orderId: colDto.orderId }, include: { order: true } });
          if (!collection) throw new NotFoundException(`Payment collection for order ${colDto.orderId} not found`);
          if (collection.currency !== dto.currency) {
            throw new BadRequestException(`Payment collection for order ${colDto.orderId} is in ${collection.currency}`);
          }
          if (collection.settlementBatchId) throw new ConflictException(`Payment collection for order ${colDto.orderId} is already settled`);
          const refuse = (code: string, message: string): never => { throw new ConflictException({ code, message, orderId: colDto.orderId }); };
          if (collection.order.status !== 'delivered') refuse('ORDER_NOT_DELIVERED', `Order ${collection.order.orderNumber} was not delivered; there is no cash to settle`);
          if (collection.status !== 'collected' || collection.declaredAmount === null) {
            refuse('CASH_NOT_DECLARED', `No driver declared cash for order ${collection.order.orderNumber}`);
          }
          if (collection.courierId !== dto.courierId) refuse('COURIER_MISMATCH', `Cash for order ${collection.order.orderNumber} was declared by another driver`);
          if (collection.locationId !== dto.locationId) refuse('COLLECTION_FROM_ANOTHER_HUB', `Cash for order ${collection.order.orderNumber} belongs to another hub`);

          totalExpected = totalExpected.plus(collection.expectedAmount);
          const collected = new Prisma.Decimal(colDto.collectedAmount);
          let status: SettlementStatus = 'settled';
          if (collected.lessThan(collection.expectedAmount)) status = 'short';
          if (collected.greaterThan(collection.expectedAmount)) status = 'over';

          // Conditional update: a collection is settled at most once, even under concurrent batches.
          const settled = await tx.paymentCollection.updateMany({
            where: { id: collection.id, status: 'collected', settlementBatchId: null },
            data: { collectedAmount: collected, status, settlementBatchId: batch.id },
          });
          if (settled.count !== 1) throw new ConflictException(`Payment collection for order ${colDto.orderId} is already settled`);
        }

        await tx.courierSettlementBatch.update({ where: { id: batch.id }, data: { totalExpected } });
        return batch.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await replay();
        if (raced) return raced;
      }
      throw error;
    }
    return this.getSettlementBatch(batchId);
  }

  /**
   * Cashier/admin queue of COD collections by hub (GLO-239): expected, declared and counted cash
   * side by side, with the variance; `locationIds` is the caller's hub scope ('all' for admins).
   */
  async listCollections(filter: { locationIds: string[] | 'all'; locationId?: string; status?: SettlementStatus; courierId?: string; take: number; skip: number }) {
    if (filter.locationIds !== 'all' && filter.locationId && !filter.locationIds.includes(filter.locationId)) {
      throw new ForbiddenException('Operator is not assigned to this hub');
    }
    const where: Prisma.PaymentCollectionWhereInput = {
      ...(filter.locationId ? { locationId: filter.locationId } : filter.locationIds !== 'all' ? { locationId: { in: filter.locationIds } } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.courierId ? { courierId: filter.courierId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.paymentCollection.count({ where }),
      this.prisma.paymentCollection.findMany({ where, orderBy: { updatedAt: 'desc' }, take: filter.take, skip: filter.skip,
        include: { order: { select: { orderNumber: true, status: true } } } }),
    ]);
    return { total, items: rows.map(c => ({
      orderId: c.orderId, orderNumber: c.order.orderNumber, orderStatus: c.order.status, locationId: c.locationId,
      courierId: c.courierId, status: c.status, currency: c.currency, settlementBatchId: c.settlementBatchId,
      expectedAmount: c.expectedAmount.toFixed(2), declaredAmount: c.declaredAmount?.toFixed(2) ?? null,
      countedAmount: c.collectedAmount?.toFixed(2) ?? null,
      variance: c.collectedAmount ? c.collectedAmount.minus(c.expectedAmount).toFixed(2) : null,
      declaredAt: c.declaredAt, updatedAt: c.updatedAt,
    })) };
  }

  async listSettlementBatches(filter: { locationIds: string[] | 'all'; locationId?: string; take: number; skip: number }) {
    if (filter.locationIds !== 'all' && filter.locationId && !filter.locationIds.includes(filter.locationId)) {
      throw new ForbiddenException('Operator is not assigned to this hub');
    }
    const where: Prisma.CourierSettlementBatchWhereInput = filter.locationId ? { locationId: filter.locationId }
      : filter.locationIds !== 'all' ? { locationId: { in: filter.locationIds } } : {};
    const [total, items] = await Promise.all([
      this.prisma.courierSettlementBatch.count({ where }),
      this.prisma.courierSettlementBatch.findMany({ where, orderBy: { settledAt: 'desc' }, take: filter.take, skip: filter.skip }),
    ]);
    return { total, items };
  }

  /** A settlement with every line's expected, driver-declared and counted cash and their variances. */
  async getSettlementBatch(id: string) {
    const batch = await this.prisma.courierSettlementBatch.findUnique({
      where: { id }, include: { collections: { include: { order: { select: { orderNumber: true } } } } },
    });
    if (!batch) throw new NotFoundException('Settlement batch not found');
    const { collections, ...header } = batch;
    return {
      ...header,
      lines: collections.map(c => ({
        orderId: c.orderId,
        orderNumber: c.order.orderNumber,
        status: c.status,
        expectedAmount: c.expectedAmount.toFixed(2),
        declaredAmount: c.declaredAmount?.toFixed(2) ?? null,
        countedAmount: c.collectedAmount?.toFixed(2) ?? null,
        variance: c.collectedAmount ? c.collectedAmount.minus(c.expectedAmount).toFixed(2) : null,
        countVersusDeclared: c.collectedAmount && c.declaredAmount ? c.collectedAmount.minus(c.declaredAmount).toFixed(2) : null,
      })),
    };
  }
}
