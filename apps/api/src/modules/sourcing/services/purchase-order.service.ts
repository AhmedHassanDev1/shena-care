import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
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
    // Only this order's lines, each once: a confirmation must never write another order's line.
    if (dtoLineIds.length !== lineIds.length || new Set(dtoLineIds).size !== dtoLineIds.length) {
      throw new BadRequestException('Confirmation must list each line of this purchase order exactly once');
    }
    const confirmations = dto.lines.map(line => {
      const original = order.lines.find(l => l.id === line.id)!;
      return { original, status: line.status, quantity: this.confirmedQuantityFor(original.requestedQuantity, line) };
    });

    const result = await this.prisma.$transaction(async (tx: any) => {
      let isPartial = false;
      const shortages: { skuId: string; missingQty: number }[] = [];

      // Claim the order first so a replayed or concurrent confirmation cannot apply twice.
      const claimed = await tx.supplierPurchaseOrder.updateMany({
        where: { id, status: { in: [PurchaseOrderStatus.created, PurchaseOrderStatus.sent, PurchaseOrderStatus.reviewed] } },
        data: { status: PurchaseOrderStatus.confirmed },
      });
      if (claimed.count !== 1) throw new ConflictException('PurchaseOrder was already confirmed');

      for (const { original, status, quantity } of confirmations) {
        if (status !== PurchaseOrderLineStatus.confirmed_full) {
          isPartial = true;
          const missing = original.requestedQuantity - quantity;
          if (missing > 0) shortages.push({ skuId: original.skuId, missingQty: missing });
        }

        await tx.purchaseOrderLine.update({
          where: { id: original.id },
          data: { status, confirmedQuantity: quantity },
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
        if (quantity !== undefined && quantity !== 0) throw new BadRequestException('An unavailable line confirms no quantity');
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
          }]
        }
      },
      include: { lines: true }
    });

    return newOrder;
  }
}
