import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SettlementStatus, OrderResolutionType, OrderResolutionStatus, Prisma } from '@prisma/client';

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

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

      return resolution;
    });
  }

  // --- GLO-128: COD Settlement Reconciliation ---

  async initializePaymentCollection(orderId: string, amount: Prisma.Decimal | number, currency: string) {
    if (!this.isUuid(orderId)) throw new BadRequestException('Invalid order ID');
    
    return this.prisma.paymentCollection.upsert({
      where: { orderId },
      update: { expectedAmount: amount, currency },
      create: {
        orderId,
        expectedAmount: amount,
        currency,
        status: 'expected'
      }
    });
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
    const fees = dto.fees || 0;
    
    return this.prisma.$transaction(async (tx) => {
      let totalExpected = 0;
      
      const batch = await tx.courierSettlementBatch.create({
        data: {
          reference: dto.reference,
          courierId: dto.courierId,
          totalExpected: 0, // Computed below
          totalCollected: dto.totalCollected,
          fees,
          netSettled: dto.totalCollected - fees,
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

        totalExpected += Number(collection.expectedAmount);
        
        let status: SettlementStatus = 'settled';
        const expected = Number(collection.expectedAmount);
        const collected = colDto.collectedAmount;

        if (collected < expected) status = 'short';
        if (collected > expected) status = 'over';

        await tx.paymentCollection.update({
          where: { id: collection.id },
          data: {
            collectedAmount: collected,
            status,
            settlementBatchId: batch.id
          }
        });
      }

      const updatedBatch = await tx.courierSettlementBatch.update({
        where: { id: batch.id },
        data: { totalExpected }
      });

      return updatedBatch;
    });
  }
}
