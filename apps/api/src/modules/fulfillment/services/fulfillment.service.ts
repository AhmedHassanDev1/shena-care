import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService } from '../../ordering/public';
import { CreateLocationDto, AllocateShipmentDto, UpdateShipmentStatusDto, StartPreparationDto, ScanItemDto, RecordShipmentEventDto } from '../dto/fulfillment.dto';
import { ShipmentStatus, PreparationSessionStatus, Prisma } from '@prisma/client';
import * as crypto from 'crypto';

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

  async startPreparationSession(shipmentId: string, dto: StartPreparationDto) {
    if (!this.isUuid(shipmentId)) throw new BadRequestException('Invalid shipment ID');
    
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { preparationSessions: true }
    });

    if (!shipment) throw new NotFoundException('Shipment not found');

    const activeSession = shipment.preparationSessions.find(s => s.status === PreparationSessionStatus.in_progress);
    if (activeSession) {
      return activeSession;
    }

    const updateResult = await this.prisma.shipment.updateMany({
      where: { 
        id: shipmentId, 
        status: { in: ['pending', 'ready_to_prepare'] }
      },
      data: { status: 'preparing' }
    });

    if (updateResult.count === 0) {
      throw new BadRequestException(`Cannot start preparation for shipment in status ${shipment.status}. Concurrency conflict or invalid state.`);
    }

    return this.prisma.shipmentPreparationSession.create({
      data: {
        shipmentId,
        operatorId: dto.operatorId,
        status: PreparationSessionStatus.in_progress
      }
    });
  }

  async scanItem(sessionId: string, dto: ScanItemDto) {
    if (!this.isUuid(sessionId)) throw new BadRequestException('Invalid session ID');
    
    const session = await this.prisma.shipmentPreparationSession.findUnique({
      where: { id: sessionId },
      include: { 
        shipment: {
          include: { items: true }
        },
        scanEvents: true
      }
    });

    if (!session) throw new NotFoundException('Preparation session not found');
    if (session.status !== PreparationSessionStatus.in_progress) {
      throw new BadRequestException('Session is not in progress');
    }

    let skuId = dto.skuId;
    if (!skuId && dto.barcodeScanned) {
      const sku = await this.prisma.sku.findUnique({
        where: { barcode: dto.barcodeScanned }
      });
      if (!sku) {
        return this.prisma.preparationScanEvent.create({
          data: {
            sessionId,
            barcodeScanned: dto.barcodeScanned,
            isSuccessful: false,
            errorReason: 'BARCODE_NOT_FOUND'
          }
        });
      }
      skuId = sku.id;
    }

    if (!skuId) {
      throw new BadRequestException('Either skuId or barcodeScanned is required');
    }

    const expectedItem = session.shipment.items.find(item => item.skuId === skuId);
    
    if (!expectedItem) {
      return this.prisma.preparationScanEvent.create({
        data: {
          sessionId,
          skuId,
          barcodeScanned: dto.barcodeScanned,
          isSuccessful: false,
          errorReason: 'WRONG_ITEM'
        }
      });
    }

    const alreadyScannedCount = session.scanEvents.filter(
      event => event.skuId === skuId && event.isSuccessful
    ).length;

    if (alreadyScannedCount >= expectedItem.quantity) {
      return this.prisma.preparationScanEvent.create({
        data: {
          sessionId,
          skuId,
          barcodeScanned: dto.barcodeScanned,
          isSuccessful: false,
          errorReason: 'EXCESS_QUANTITY'
        }
      });
    }

    return this.prisma.preparationScanEvent.create({
      data: {
        sessionId,
        skuId,
        barcodeScanned: dto.barcodeScanned,
        isSuccessful: true
      }
    });
  }

  async completePreparationSession(sessionId: string) {
    if (!this.isUuid(sessionId)) throw new BadRequestException('Invalid session ID');
    
    const session = await this.prisma.shipmentPreparationSession.findUnique({
      where: { id: sessionId },
      include: { 
        shipment: { include: { items: true } },
        scanEvents: true
      }
    });

    if (!session) throw new NotFoundException('Preparation session not found');
    if (session.status !== PreparationSessionStatus.in_progress) {
      throw new BadRequestException('Session is not in progress');
    }

    const missingItems = [];
    for (const item of session.shipment.items) {
      const scannedCount = session.scanEvents.filter(
        event => event.skuId === item.skuId && event.isSuccessful
      ).length;
      if (scannedCount !== item.quantity) {
        missingItems.push({ skuId: item.skuId, expected: item.quantity, scanned: scannedCount });
      }
    }

    if (missingItems.length > 0) {
      throw new BadRequestException({
        message: 'Cannot complete preparation, items do not match exactly',
        missingItems
      });
    }

    await this.prisma.$transaction([
      this.prisma.shipmentPreparationSession.updateMany({
        where: { id: sessionId, status: PreparationSessionStatus.in_progress },
        data: {
          status: PreparationSessionStatus.completed,
          completedAt: new Date()
        }
      }),
      this.prisma.shipment.update({
        where: { id: session.shipmentId },
        data: { status: 'prepared' }
      })
    ]);

    return { success: true };
  }

  async generateShipmentLabel(shipmentId: string) {
    if (!this.isUuid(shipmentId)) throw new BadRequestException('Invalid shipment ID');
    
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        items: true,
      }
    });

    if (!shipment) throw new NotFoundException('Shipment not found');

    if (shipment.status !== 'prepared' && shipment.status !== 'ready_to_pack' && shipment.status !== 'packed') {
      throw new BadRequestException(`Cannot generate label for shipment in status ${shipment.status}`);
    }

    const order = await this.orderingService.getOrder(shipment.orderId);
    if (!order) throw new NotFoundException('Order not found');

    // Create an opaque token/barcode data for the shipment
    const signature = crypto.createHmac('sha256', process.env.SECRET_KEY || 'default-secret-key')
      .update(shipment.id)
      .digest('hex')
      .substring(0, 16);
      
    const barcode = `SHP-${shipment.id.substring(0, 8).toUpperCase()}-${signature.toUpperCase()}`;

    // Record the LABEL_PRINTED event
    await this.recordShipmentEvent(shipmentId, {
      type: 'LABEL_PRINTED',
      notes: 'Generated shipment label with barcode',
    });

    return {
      shipmentId: shipment.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone, // Minimum required for handoff
      shippingAddress: order.shippingAddress,
      totalAmount: order.totalAmount, // COD amount
      currency: order.currency,
      packageCount: 1, // Defaulting to 1 for MVP
      barcode,
    };
  }

  async recordShipmentEvent(shipmentId: string, dto: RecordShipmentEventDto) {
    if (!this.isUuid(shipmentId)) throw new BadRequestException('Invalid shipment ID');

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId }
    });

    if (!shipment) throw new NotFoundException('Shipment not found');

    if (dto.type === 'OUT_FOR_DELIVERY' || dto.type === 'HANDOFF_SCANNED') {
      if (shipment.status !== 'packed' && shipment.status !== 'dispatched') {
        throw new BadRequestException(`Shipment must be packed before dispatch. Current status: ${shipment.status}`);
      }
    }

    const event = await this.prisma.shipmentEvent.create({
      data: {
        shipmentId,
        type: dto.type,
        actorId: dto.actorId,
        notes: dto.notes,
      }
    });

    // Handle status changes based on event type
    let newStatus: ShipmentStatus | undefined;
    switch (dto.type) {
      case 'PACKED':
        newStatus = 'packed';
        break;
      case 'OUT_FOR_DELIVERY':
        newStatus = 'out_for_delivery';
        break;
      case 'DELIVERED':
        newStatus = 'delivered';
        break;
      case 'RETURNED':
        newStatus = 'returned';
        break;
      case 'FAILED':
        newStatus = 'failed';
        break;
    }

    if (newStatus && shipment.status !== newStatus) {
      await this.updateShipmentStatus(shipmentId, { status: newStatus });
    }

    return event;
  }
}
