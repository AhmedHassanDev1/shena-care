import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SettlementStatus, OrderResolutionType, OrderResolutionStatus, Prisma, RefundStatus } from '@prisma/client';
import { OutboxService } from '../../operations/services/outbox.service';

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
      const resolution = await tx.orderResolution.update({
        where: { id: resolutionId },
        data: { status }
      });

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
      });

      if (!resolution) throw new NotFoundException('Resolution not found');
      
      const existingRefund = await tx.refundTransaction.findUnique({
        where: { resolutionId }
      });
      if (existingRefund) throw new BadRequestException('Refund already initiated for this resolution');

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
      const refund = await tx.refundTransaction.update({
        where: { resolutionId },
        data: {
          status,
          providerRef,
          errorReason
        },
        include: { resolution: { include: { order: true } } }
      });

      if (status === 'succeeded' || status === 'failed') {
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

  async createSettlementBatch(dto: {
    courierId: string;
    reference: string;
    totalCollected: number;
    fees?: number;
    currency: string;
    actorId: string;
    notes?: string;
    collections: { orderId: string; collectedAmount: number }[];
  }) {
    // Money is exact Decimal arithmetic; the declared total must match the line items.
    const fees = new Prisma.Decimal(dto.fees ?? 0);
    const totalCollected = new Prisma.Decimal(dto.totalCollected);
    const orderIds = dto.collections.map(c => c.orderId);
    if (new Set(orderIds).size !== orderIds.length) throw new BadRequestException('Each order may appear only once per settlement');
    const lineTotal = dto.collections.reduce((sum, c) => sum.plus(c.collectedAmount), new Prisma.Decimal(0));
    if (!lineTotal.equals(totalCollected)) throw new BadRequestException('totalCollected must equal the sum of collected amounts');
    if (fees.greaterThan(totalCollected)) throw new BadRequestException('Fees cannot exceed the collected total');

    return this.prisma.$transaction(async (tx) => {
      let totalExpected = new Prisma.Decimal(0);

      const batch = await tx.courierSettlementBatch.create({
        data: {
          reference: dto.reference,
          courierId: dto.courierId,
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
        if (!this.isUuid(colDto.orderId)) throw new BadRequestException(`Invalid order ID: ${colDto.orderId}`);
        
        const collection = await tx.paymentCollection.findUnique({
          where: { orderId: colDto.orderId }
        });

        if (!collection) {
          throw new NotFoundException(`Payment collection for order ${colDto.orderId} not found`);
        }
        if (collection.currency !== dto.currency) {
          throw new BadRequestException(`Payment collection for order ${colDto.orderId} is in ${collection.currency}`);
        }

        totalExpected = totalExpected.plus(collection.expectedAmount);

        const collected = new Prisma.Decimal(colDto.collectedAmount);
        let status: SettlementStatus = 'settled';
        if (collected.lessThan(collection.expectedAmount)) status = 'short';
        if (collected.greaterThan(collection.expectedAmount)) status = 'over';

        // Conditional update: a collection is settled at most once, even under concurrent batches.
        const settled = await tx.paymentCollection.updateMany({
          where: { id: collection.id, status: 'expected', settlementBatchId: null },
          data: {
            collectedAmount: collected,
            status,
            settlementBatchId: batch.id
          }
        });
        if (settled.count !== 1) {
          throw new ConflictException(`Payment collection for order ${colDto.orderId} is already settled`);
        }
      }

      const updatedBatch = await tx.courierSettlementBatch.update({
        where: { id: batch.id },
        data: { totalExpected }
      });

      return updatedBatch;
    });
  }
}
