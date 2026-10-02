import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CreatePurchaseOrderDto, ConfirmPurchaseOrderDto } from '../dto/purchase-order.dto';
import { PurchaseOrderStatus, PurchaseOrderLineStatus } from '@prisma/client';
import { RankingService } from './ranking.service';

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rankingService: RankingService
  ) {}

  async createPurchaseOrder(dto: CreatePurchaseOrderDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier not found with id: ${dto.supplierId}`);
    }

    const order = await this.prisma.supplierPurchaseOrder.create({
      data: {
        supplierId: dto.supplierId,
        status: PurchaseOrderStatus.created,
        lines: {
          create: dto.lines.map((line) => ({
            skuId: line.skuId,
            requestedQuantity: line.requestedQuantity,
            status: PurchaseOrderLineStatus.pending,
          })),
        },
      },
      include: {
        lines: true,
      },
    });

    return order;
  }

  async getPurchaseOrder(id: string) {
    const order = await this.prisma.supplierPurchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!order) {
      throw new NotFoundException(`PurchaseOrder not found with id: ${id}`);
    }

    return order;
  }

  async confirmPurchaseOrder(id: string, dto: ConfirmPurchaseOrderDto) {
    const order = await this.getPurchaseOrder(id);

    if (order.status !== PurchaseOrderStatus.created && order.status !== PurchaseOrderStatus.sent && order.status !== PurchaseOrderStatus.reviewed) {
      throw new BadRequestException(`PurchaseOrder cannot be confirmed in status: ${order.status}`);
    }

    const lineIds = order.lines.map((l: any) => l.id);
    const dtoLineIds = dto.lines.map((l: any) => l.id);
    const missingLines = lineIds.filter((id: string) => !dtoLineIds.includes(id));

    if (missingLines.length > 0) {
      throw new BadRequestException(`Missing confirmation for lines: ${missingLines.join(', ')}`);
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      let isPartial = false;
      const shortages: { skuId: string; missingQty: number }[] = [];

      for (const line of dto.lines) {
        if (line.status !== PurchaseOrderLineStatus.confirmed_full) {
          isPartial = true;
          
          const originalLine = order.lines.find(l => l.id === line.id);
          if (originalLine) {
            const confirmedQty = line.confirmedQuantity ?? 0;
            const missing = originalLine.requestedQuantity - confirmedQty;
            if (missing > 0) {
              shortages.push({ skuId: originalLine.skuId, missingQty: missing });
            }
          }
        }

        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: {
            status: line.status,
            confirmedQuantity: line.confirmedQuantity,
          },
        });
      }

      const updatedOrder = await tx.supplierPurchaseOrder.update({
        where: { id },
        data: {
          status: isPartial ? PurchaseOrderStatus.partial : PurchaseOrderStatus.confirmed,
        },
        include: { lines: true },
      });

      return { updatedOrder, shortages };
    });

    // Handle fallback: Auto-source the shortage asynchronously or queue it.
    // For MVP, we'll try to immediately auto-source it, wrapping in try/catch to avoid failing the confirmation
    if (result.shortages.length > 0) {
      for (const shortage of result.shortages) {
        try {
          await this.autoSourceDemand(shortage.skuId, shortage.missingQty, [order.supplierId], 0);
        } catch (err) {
          console.error(`Failed to auto-source shortage for SKU ${shortage.skuId}:`, err);
        }
      }
    }

    return result.updatedOrder;
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
          }]
        }
      },
      include: { lines: true }
    });

    return newOrder;
  }
}
