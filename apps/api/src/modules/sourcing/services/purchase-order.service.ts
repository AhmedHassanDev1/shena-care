import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CreatePurchaseOrderDto, ConfirmPurchaseOrderDto } from '../dto/purchase-order.dto';
import { PurchaseOrderStatus, PurchaseOrderLineStatus } from '@prisma/client';

@Injectable()
export class PurchaseOrderService {
  constructor(private readonly prisma: PrismaService) {}

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

    // Validate that all lines are provided
    const lineIds = order.lines.map((l: any) => l.id);
    const dtoLineIds = dto.lines.map((l: any) => l.id);
    const missingLines = lineIds.filter((id: string) => !dtoLineIds.includes(id));

    if (missingLines.length > 0) {
      throw new BadRequestException(`Missing confirmation for lines: ${missingLines.join(', ')}`);
    }

    // Start a transaction to update lines and the order
    const result = await this.prisma.$transaction(async (tx: any) => {
      let isPartial = false;

      for (const line of dto.lines) {
        if (line.status !== PurchaseOrderLineStatus.confirmed_full) {
          isPartial = true;
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

      return updatedOrder;
    });

    return result;
  }
}
