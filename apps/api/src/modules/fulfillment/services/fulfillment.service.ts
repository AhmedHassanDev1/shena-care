import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService } from '../../ordering/public';
import { CreateLocationDto, AllocateShipmentDto, UpdateShipmentStatusDto } from '../dto/fulfillment.dto';
import { ShipmentStatus, Prisma } from '@prisma/client';

export interface FulfillmentLocationDetail {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  createdAt: Date;
}

export interface ShipmentDetail {
  id: string;
  orderId: string;
  locationId: string;
  status: ShipmentStatus;
  trackingNumber: string | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  items: Array<{
    id: string;
    skuId: string;
    quantity: number;
  }>;
}

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderingService: OrderingService,
  ) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  async createLocation(dto: CreateLocationDto): Promise<FulfillmentLocationDetail> {
    const existing = await this.prisma.fulfillmentLocation.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new BadRequestException('Fulfillment location with this name already exists.');
    }

    return this.prisma.fulfillmentLocation.create({
      data: dto,
    });
  }

  async getLocations(): Promise<FulfillmentLocationDetail[]> {
    return this.prisma.fulfillmentLocation.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async allocateShipment(dto: AllocateShipmentDto): Promise<ShipmentDetail> {
    if (!this.isUuid(dto.locationId)) throw new BadRequestException('Invalid location ID');

    const location = await this.prisma.fulfillmentLocation.findUnique({
      where: { id: dto.locationId },
    });

    if (!location || !location.isActive) {
      throw new NotFoundException('Active fulfillment location not found');
    }

    // Verify order exists and is valid for fulfillment
    const order = await this.orderingService.getOrder(dto.orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    
    // Only allow allocation if order is not already allocated and is confirmed/placed
    if (order.status !== 'placed' && order.status !== 'confirmed') {
      throw new BadRequestException(`Order cannot be allocated. Current status: ${order.status}`);
    }

    const existingShipment = await this.prisma.shipment.findUnique({
      where: { orderId: order.id },
    });

    if (existingShipment) {
      throw new BadRequestException('Order is already allocated to a shipment');
    }

    // Update order status to packing
    await this.orderingService.updateOrderStatus(order.id, 'packing');

    return this.prisma.shipment.create({
      data: {
        orderId: order.id,
        locationId: location.id,
        status: ShipmentStatus.pending,
        items: {
          create: order.items.map((item) => ({
            skuId: item.skuId,
            quantity: item.quantity,
          })),
        },
      },
      include: { items: true },
    });
  }

  async getShipment(id: string): Promise<ShipmentDetail | null> {
    if (!this.isUuid(id)) return null;
    return this.prisma.shipment.findUnique({
      where: { id },
      include: { items: true },
    });
  }

  async getShipmentByOrder(orderId: string): Promise<ShipmentDetail | null> {
    if (!this.isUuid(orderId)) return null;
    return this.prisma.shipment.findUnique({
      where: { orderId },
      include: { items: true },
    });
  }

  async updateShipmentStatus(id: string, dto: UpdateShipmentStatusDto): Promise<ShipmentDetail> {
    const shipment = await this.getShipment(id);
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    const updateData: Prisma.ShipmentUpdateInput = { status: dto.status };
    if (dto.trackingNumber !== undefined) updateData.trackingNumber = dto.trackingNumber;

    if (dto.status === ShipmentStatus.dispatched && !shipment.dispatchedAt) {
      updateData.dispatchedAt = new Date();
      await this.orderingService.updateOrderStatus(shipment.orderId, 'shipped');
    } else if (dto.status === ShipmentStatus.delivered && !shipment.deliveredAt) {
      updateData.deliveredAt = new Date();
      await this.orderingService.updateOrderStatus(shipment.orderId, 'delivered');
    } else if (dto.status === ShipmentStatus.failed) {
      await this.orderingService.updateOrderStatus(shipment.orderId, 'cancelled');
    }

    return this.prisma.shipment.update({
      where: { id },
      data: updateData,
      include: { items: true },
    });
  }
}
