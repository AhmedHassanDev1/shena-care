import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { PayableStatus, Prisma } from '@prisma/client';

@Injectable()
export class PayablesService {
  constructor(private readonly prisma: PrismaService) {}

  private isUuid(id: string) {
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    return uuidRegex.test(id);
  }

  async createPayableFromPO(purchaseOrderId: string) {
    if (!this.isUuid(purchaseOrderId)) throw new BadRequestException('Invalid PO ID');

    return this.prisma.$transaction(async (tx) => {
      const po = await tx.supplierPurchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { lines: true }
      });

      if (!po) throw new NotFoundException('PO not found');

      // Check if payable already exists
      const existing = await tx.supplierPayable.findFirst({
        where: { purchaseOrderId }
      });
      if (existing) throw new BadRequestException('Payable already exists for this PO');

      // For MVP, we'll calculate amount based on a fake lookup or just default to a known value
      // Realistically we need the costPrice from SupplierOffer
      
      let totalAmount = 0;
      let currency = 'USD'; // default
      
      for (const line of po.lines) {
        const offer = await tx.supplierOffer.findFirst({
          where: { supplierId: po.supplierId, skuId: line.skuId }
        });
        
        if (offer) {
          currency = offer.currency;
          totalAmount += (Number(offer.costPrice) * (line.confirmedQuantity || line.requestedQuantity));
        }
      }

      const payable = await tx.supplierPayable.create({
        data: {
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          amount: totalAmount,
          currency: currency,
          status: 'open'
        }
      });

      return payable;
    });
  }

  async adjustPayable(payableId: string, dto: {
    amount: number;
    reason: string;
    actorId: string;
  }) {
    if (!this.isUuid(payableId)) throw new BadRequestException('Invalid payable ID');
    
    return this.prisma.$transaction(async (tx) => {
      const payable = await tx.supplierPayable.findUnique({ where: { id: payableId } });
      if (!payable) throw new NotFoundException('Payable not found');
      
      const adjustment = await tx.payableAdjustment.create({
        data: {
          payableId,
          amount: dto.amount,
          reason: dto.reason,
          actorId: dto.actorId
        }
      });

      const updatedPayable = await tx.supplierPayable.update({
        where: { id: payableId },
        data: {
          amount: Number(payable.amount) + dto.amount,
          status: 'adjusted'
        }
      });

      return { payable: updatedPayable, adjustment };
    });
  }

  async markAsPaid(payableId: string, paymentRef: string) {
    if (!this.isUuid(payableId)) throw new BadRequestException('Invalid payable ID');
    
    return this.prisma.supplierPayable.update({
      where: { id: payableId },
      data: {
        status: 'paid',
        paidAt: new Date(),
        paymentRef
      }
    });
  }
}
