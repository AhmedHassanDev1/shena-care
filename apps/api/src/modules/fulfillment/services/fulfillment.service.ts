import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService } from '../../ordering/public';
import { CatalogService } from '../../catalog/public';
import { SupplyPlanService } from '../../sourcing/public';
import { CreateLocationDto, AllocateShipmentDto, UpdateShipmentStatusDto, StartPreparationDto, ScanItemDto, RecordShipmentEventDto, AdjustInventoryDto, ReceiveAllocatedGoodsDto, CreateDeliveryBatchDto, DeliveryStopInputDto } from '../dto/fulfillment.dto';
import { FulfillmentCapability, ShipmentStatus, PreparationSessionStatus, Prisma, Role } from '@prisma/client';
import * as crypto from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderDeliveredEvent } from '../../../platform/events/integration.events';
import { OutboxService } from '../../operations/services/outbox.service';

export interface FulfillmentLocationDetail {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  capabilities: FulfillmentCapability[];
  createdAt: Date;
}

interface FulfillmentActor {
  id: string;
  roles: Role[];
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
    private readonly catalogService: CatalogService,
    private readonly supplyPlanService: SupplyPlanService,
    private readonly eventEmitter: EventEmitter2,
    private readonly outbox: OutboxService,
  ) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  private async getOperationalLocation(locationId: string, capability: FulfillmentCapability) {
    if (!this.isUuid(locationId)) throw new BadRequestException('Invalid location ID');
    const location = await this.prisma.fulfillmentLocation.findUnique({ where: { id: locationId } });
    if (!location || !location.isActive) throw new NotFoundException('Active fulfillment location not found');
    if (!location.capabilities.includes(capability)) {
      throw new BadRequestException(`Fulfillment location does not support ${capability}`);
    }
    return location;
  }

  private async assertLocationAccess(locationId: string, actor: FulfillmentActor): Promise<void> {
    if (actor.roles.includes(Role.ADMIN)) return;
    if (!actor.roles.includes(Role.HUB_OPERATOR)) throw new ForbiddenException('Hub access is required');
    const assignment = await this.prisma.fulfillmentLocationOperator.findUnique({
      where: { locationId_operatorId: { locationId, operatorId: actor.id } },
    });
    if (!assignment) throw new ForbiddenException('Operator is not assigned to this fulfillment location');
  }

  async createLocation(dto: CreateLocationDto): Promise<FulfillmentLocationDetail> {
    const existing = await this.prisma.fulfillmentLocation.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new BadRequestException('Fulfillment location with this name already exists.');
    }

    return this.prisma.fulfillmentLocation.create({
      data: {
        name: dto.name,
        address: dto.address,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.capabilities !== undefined ? { capabilities: dto.capabilities } : {}),
      },
    });
  }

  async getLocations(): Promise<FulfillmentLocationDetail[]> {
    return this.prisma.fulfillmentLocation.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async assignLocationOperator(locationId: string, operatorId: string) {
    if (!this.isUuid(locationId) || !this.isUuid(operatorId)) throw new BadRequestException('Invalid ID');
    const location = await this.prisma.fulfillmentLocation.findUnique({ where: { id: locationId } });
    if (!location) throw new NotFoundException('Fulfillment location not found');
    return this.prisma.fulfillmentLocationOperator.upsert({
      where: { locationId_operatorId: { locationId, operatorId } },
      create: { locationId, operatorId },
      update: {},
    });
  }

  private receiptMatches(receipt: {
    locationId: string;
    sourceAllocationId: string;
    orderId: string;
    orderItemId: string;
    skuId: string;
    variantName: string;
    quantity: number;
    condition: string;
    actorId: string;
  }, dto: ReceiveAllocatedGoodsDto, actorId: string): boolean {
    return receipt.locationId === dto.locationId &&
      receipt.sourceAllocationId === dto.allocationId &&
      receipt.orderId === dto.orderId &&
      receipt.orderItemId === dto.orderItemId &&
      receipt.skuId === dto.skuId &&
      receipt.variantName === dto.variantName &&
      receipt.quantity === dto.quantity &&
      receipt.condition === dto.condition &&
      receipt.actorId === actorId;
  }

  private async presentReceipt(receipt: {
    id: string;
    sourceAllocationId: string;
    orderId: string;
    orderItemId: string;
    locationId: string;
    skuId: string;
    variantName: string;
    quantity: number;
    condition: string;
    idempotencyKey: string;
    actorId: string;
    receivedAt: Date;
  }, confirmedQuantity: number) {
    const [received, balance, shipment] = await Promise.all([
      this.prisma.fulfillmentReceipt.aggregate({
        where: { sourceAllocationId: receipt.sourceAllocationId },
        _sum: { quantity: true },
      }),
      this.prisma.inventoryBalance.findUnique({
        where: { locationId_skuId: { locationId: receipt.locationId, skuId: receipt.skuId } },
      }),
      this.prisma.shipment.findUnique({ where: { orderId: receipt.orderId } }),
    ]);
    const receivedQuantity = received._sum.quantity ?? 0;
    return {
      receipt,
      allocation: {
        id: receipt.sourceAllocationId,
        confirmedQuantity,
        receivedQuantity,
        remainingQuantity: Math.max(confirmedQuantity - receivedQuantity, 0),
      },
      inventory: balance,
      shipment: shipment ? { id: shipment.id, status: shipment.status, locationId: shipment.locationId } : null,
    };
  }

  async receiveAllocatedGoods(dto: ReceiveAllocatedGoodsDto, actor: FulfillmentActor) {
    await this.getOperationalLocation(dto.locationId, FulfillmentCapability.RECEIVE_SUPPLIER_GOODS);
    await this.assertLocationAccess(dto.locationId, actor);

    const prior = await this.prisma.fulfillmentReceipt.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (prior) {
      if (!this.receiptMatches(prior, dto, actor.id)) {
        throw new ConflictException('Idempotency key was already used for a different receipt');
      }
      const order = await this.orderingService.getOrder(prior.orderId);
      if (order && (order.status === 'placed' || order.status === 'confirmed')) {
        await this.orderingService.updateOrderStatus(order.id, 'packing');
      }
      return this.presentReceipt(prior, prior.allocationConfirmedQuantity);
    }

    const allocation = await this.supplyPlanService.getReceivableAllocation(dto.allocationId);
    if (allocation.orderId !== dto.orderId || allocation.orderItemId !== dto.orderItemId || allocation.skuId !== dto.skuId) {
      throw new BadRequestException('Receipt does not match the Supply Plan allocation');
    }
    if (dto.condition !== 'ACCEPTABLE') {
      throw new BadRequestException(`Goods in ${dto.condition} condition cannot be allocated to an order`);
    }

    const [sku, order] = await Promise.all([
      this.catalogService.getSkuIdentity(dto.skuId),
      this.orderingService.getOrder(dto.orderId),
    ]);
    if (!sku) throw new NotFoundException('SKU not found');
    if (sku.variantName !== dto.variantName) throw new BadRequestException('Received variant does not match the allocated SKU');
    if (!order) throw new NotFoundException('Order not found');
    if (!['placed', 'confirmed', 'packing'].includes(order.status)) {
      throw new ConflictException(`Order cannot receive goods in status ${order.status}`);
    }
    const orderItem = order.items.find(item => item.id === dto.orderItemId);
    if (!orderItem || orderItem.skuId !== dto.skuId) {
      throw new BadRequestException('Receipt does not match an active order item');
    }

    const receipt = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44080, hashtext(${dto.idempotencyKey}))::text AS locked`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44081, hashtext(${dto.orderId}))::text AS locked`;

      const replay = await tx.fulfillmentReceipt.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (replay) {
        if (!this.receiptMatches(replay, dto, actor.id)) {
          throw new ConflictException('Idempotency key was already used for a different receipt');
        }
        return replay;
      }

      const received = await tx.fulfillmentReceipt.aggregate({
        where: { sourceAllocationId: dto.allocationId },
        _sum: { quantity: true },
      });
      const alreadyReceived = received._sum.quantity ?? 0;
      if (alreadyReceived + dto.quantity > allocation.confirmedQuantity) {
        throw new BadRequestException('Receipt quantity exceeds the unreceived confirmed allocation quantity');
      }
      const itemReceived = await tx.fulfillmentReceipt.aggregate({
        where: { orderId: dto.orderId, orderItemId: dto.orderItemId },
        _sum: { quantity: true },
      });
      if ((itemReceived._sum.quantity ?? 0) + dto.quantity > orderItem.quantity) {
        throw new BadRequestException('Receipt quantity exceeds the remaining order item quantity');
      }

      let shipment = await tx.shipment.findUnique({ where: { orderId: dto.orderId } });
      if (shipment && shipment.locationId !== dto.locationId) {
        throw new ConflictException('Order shipment is allocated to another fulfillment location');
      }
      if (shipment && !['pending', 'ready_to_prepare'].includes(shipment.status)) {
        throw new ConflictException(`Shipment cannot receive goods in status ${shipment.status}`);
      }
      if (!shipment) {
        shipment = await tx.shipment.create({
          data: {
            orderId: order.id,
            locationId: dto.locationId,
            status: ShipmentStatus.pending,
            items: { create: order.items.map(item => ({ skuId: item.skuId, quantity: item.quantity })) },
          },
        });
      }

      const balance = await tx.inventoryBalance.upsert({
        where: { locationId_skuId: { locationId: dto.locationId, skuId: dto.skuId } },
        create: {
          locationId: dto.locationId,
          skuId: dto.skuId,
          orderAllocatedExternalGoods: dto.quantity,
          ownedOnHand: 0,
          reserved: 0,
          availableToSell: 0,
        },
        update: { orderAllocatedExternalGoods: { increment: dto.quantity } },
      });
      const inventoryTransaction = await tx.inventoryTransaction.create({
        data: {
          balanceId: balance.id,
          type: 'RECEIVE_ORDER_ALLOCATED',
          quantity: dto.quantity,
          reason: 'Received against confirmed Supply Plan allocation',
          actorId: actor.id,
          referenceId: dto.allocationId,
        },
      });
      const created = await tx.fulfillmentReceipt.create({
        data: {
          locationId: dto.locationId,
          supplyRequestId: allocation.supplyRequestId,
          sourceAllocationId: dto.allocationId,
          orderId: dto.orderId,
          orderItemId: dto.orderItemId,
          skuId: dto.skuId,
          variantName: dto.variantName,
          quantity: dto.quantity,
          allocationConfirmedQuantity: allocation.confirmedQuantity,
          condition: dto.condition,
          idempotencyKey: dto.idempotencyKey,
          actorId: actor.id,
          inventoryTransactionId: inventoryTransaction.id,
        },
      });

      const totals = await tx.fulfillmentReceipt.groupBy({
        by: ['orderItemId'],
        where: { orderId: dto.orderId },
        _sum: { quantity: true },
      });
      const receivedByItem = new Map(totals.map(total => [total.orderItemId, total._sum.quantity ?? 0]));
      const orderComplete = order.items.every(item => (receivedByItem.get(item.id) ?? 0) >= item.quantity);
      if (orderComplete && shipment.status === ShipmentStatus.pending) {
        await tx.shipment.update({ where: { id: shipment.id }, data: { status: ShipmentStatus.ready_to_prepare } });
      }
      return created;
    }, { timeout: 30000 });

    if (order.status === 'placed' || order.status === 'confirmed') {
      await this.orderingService.updateOrderStatus(order.id, 'packing');
    }
    return this.presentReceipt(receipt, allocation.confirmedQuantity);
  }

  async createShipmentFromOrder(event: import('../../../platform/events/integration.events').OrderPlacedEvent): Promise<ShipmentDetail> {
    const location = await this.prisma.fulfillmentLocation.findFirst({
      where: { isActive: true, capabilities: { has: FulfillmentCapability.PREPARE_ORDERS } }
    });

    if (!location) {
      throw new BadRequestException('No active fulfillment location available to route order.');
    }

    const existingShipment = await this.prisma.shipment.findUnique({
      where: { orderId: event.orderId },
      include: { items: true },
    });

    if (existingShipment) {
      return existingShipment; // already allocated
    }

    // Update order status to packing
    await this.orderingService.updateOrderStatus(event.orderId, 'packing');

    return this.prisma.shipment.create({
      data: {
        orderId: event.orderId,
        locationId: location.id,
        status: ShipmentStatus.pending,
        items: {
          create: event.items.map((item) => ({
            skuId: item.skuId,
            quantity: item.quantity,
          })),
        },
      },
      include: {
        items: true,
      },
    }) as unknown as ShipmentDetail;
  }

  async allocateShipment(dto: AllocateShipmentDto): Promise<ShipmentDetail> {
    const location = await this.getOperationalLocation(dto.locationId, FulfillmentCapability.PREPARE_ORDERS);

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
    } else if (dto.status === ShipmentStatus.out_for_delivery && shipment.status !== ShipmentStatus.out_for_delivery) {
      const order = await this.orderingService.getOrder(shipment.orderId);
      if (order) {
        await this.outbox.enqueue(this.prisma, {
          eventType: 'shipment.out_for_delivery',
          aggregateId: shipment.id,
          aggregateType: 'Shipment',
          customerId: order.customerId || undefined,
          payload: { orderId: order.id, orderNumber: order.orderNumber, trackingNumber: shipment.trackingNumber },
          channelIntent: 'whatsapp',
          templateId: 'out_for_delivery_v1',
          deduplicationKey: `shipment.out_for_delivery:${shipment.id}`,
        });
      }
    } else if (dto.status === ShipmentStatus.delivered && !shipment.deliveredAt) {
      updateData.deliveredAt = new Date();
      await this.orderingService.updateOrderStatus(shipment.orderId, 'delivered');
      
      const order = await this.orderingService.getOrder(shipment.orderId);
      if (order) {
        this.eventEmitter.emit(
          'order.delivered',
          new OrderDeliveredEvent(
            shipment.orderId,
            order.customerId || 'unknown',
            shipment.items.map(i => ({ productId: i.skuId })),
            updateData.deliveredAt
          )
        );
        
        await this.outbox.enqueue(this.prisma, {
          eventType: 'shipment.delivered',
          aggregateId: shipment.id,
          aggregateType: 'Shipment',
          customerId: order.customerId || undefined,
          payload: { orderId: order.id, orderNumber: order.orderNumber },
          channelIntent: 'whatsapp',
          templateId: 'delivered_v1',
          deduplicationKey: `shipment.delivered:${shipment.id}`,
        });
      }
    } else if (dto.status === ShipmentStatus.failed) {
      await this.orderingService.updateOrderStatus(shipment.orderId, 'cancelled');
      
      const order = await this.orderingService.getOrder(shipment.orderId);
      if (order) {
        await this.outbox.enqueue(this.prisma, {
          eventType: 'shipment.failed',
          aggregateId: shipment.id,
          aggregateType: 'Shipment',
          customerId: order.customerId || undefined,
          payload: { orderId: order.id, orderNumber: order.orderNumber, reason: 'Delivery failed' },
          channelIntent: 'whatsapp',
          templateId: 'delivery_failed_v1',
          deduplicationKey: `shipment.failed:${shipment.id}`,
        });
      }
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
    await this.getOperationalLocation(shipment.locationId, FulfillmentCapability.PREPARE_ORDERS);

    const activeSession = shipment.preparationSessions.find(s => s.status === PreparationSessionStatus.in_progress);
    if (activeSession) {
      return activeSession;
    }

    return this.prisma.$transaction(async tx => {
      const updateResult = await tx.shipment.updateMany({
        where: { id: shipmentId, status: { in: ['pending', 'ready_to_prepare'] } },
        data: { status: 'preparing' }
      });
      if (updateResult.count === 0) {
        throw new BadRequestException(`Cannot start preparation for shipment in status ${shipment.status}. Concurrency conflict or invalid state.`);
      }
      const session = await tx.shipmentPreparationSession.create({
        data: { shipmentId, operatorId: dto.operatorId, status: PreparationSessionStatus.in_progress }
      });
      await tx.shipmentEvent.create({ data: { shipmentId, type: 'PREPARATION_STARTED' } });
      return session;
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

  // --- Delivery Batch Planning (GLO-149) ---

  async getEligibleShipmentsForBatching(locationId: string) {
    await this.getOperationalLocation(locationId, FulfillmentCapability.DISPATCH_SHIPMENTS);
    // Eligible shipments are packed (ready for dispatch) and not already assigned to a stop
    return this.prisma.shipment.findMany({
      where: {
        locationId,
        status: 'packed',
        deliveryStops: { none: {} }
      },
      include: { items: true }
    });
  }

  async createDeliveryBatch(dto: CreateDeliveryBatchDto) {
    if (!this.isUuid(dto.hubId)) throw new BadRequestException('Invalid hub ID');
    return this.prisma.deliveryBatch.create({
      data: {
        id: crypto.randomUUID(),
        status: 'planning',
        driverId: dto.driverId,
        stops: {
          create: []
        }
      }
    });
  }

  async addStopsToBatch(batchId: string, stops: DeliveryStopInputDto[]) {
    if (!this.isUuid(batchId)) throw new BadRequestException('Invalid batch ID');
    
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({ where: { id: batchId }, include: { stops: true } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'planning') {
        throw new BadRequestException('Cannot add stops to a dispatched/completed batch');
      }

      let currentMaxSeq = batch.stops.length > 0 ? Math.max(...batch.stops.map(s => s.sequence)) : 0;

      for (const stop of stops) {
        if (!this.isUuid(stop.shipmentId)) throw new BadRequestException('Invalid shipment ID');
        
        // Ensure shipment exists and is eligible
        const shipment = await tx.shipment.findUnique({ where: { id: stop.shipmentId }, include: { deliveryStops: true } });
        if (!shipment) throw new NotFoundException(`Shipment ${stop.shipmentId} not found`);
        if (shipment.status !== 'packed') {
          throw new BadRequestException(`Shipment ${stop.shipmentId} must be packed`);
        }
        if (shipment.deliveryStops.length > 0) {
          throw new BadRequestException(`Shipment ${stop.shipmentId} is already assigned to a batch`);
        }

        const seq = stop.sequence !== undefined ? stop.sequence : ++currentMaxSeq;
        
        await tx.deliveryStop.create({
          data: {
            batchId,
            shipmentId: stop.shipmentId,
            sequence: seq
          }
        });
      }

      return tx.deliveryBatch.findUnique({
        where: { id: batchId },
        include: { stops: { orderBy: { sequence: 'asc' }, include: { shipment: true } } }
      });
    });
  }

  async updateBatchStopsSequence(batchId: string, stops: DeliveryStopInputDto[]) {
    if (!this.isUuid(batchId)) throw new BadRequestException('Invalid batch ID');
    const sequencedStops = stops.map(stop => {
      if (stop.sequence === undefined) throw new BadRequestException('Stop sequence is required');
      return { shipmentId: stop.shipmentId, sequence: stop.sequence };
    });

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'planning') {
        throw new BadRequestException('Cannot modify a dispatched/completed batch');
      }

      const uniqueSequences = new Set(sequencedStops.map(s => s.sequence));
      if (uniqueSequences.size !== sequencedStops.length) {
        throw new BadRequestException('Duplicate sequences provided');
      }

      // Instead of dropping and recreating, we should update sequence values.
      // To avoid unique constraint violation during swap, we can use negative temporary sequences.
      for (const stop of sequencedStops) {
        await tx.deliveryStop.updateMany({
          where: { batchId, shipmentId: stop.shipmentId },
          data: { sequence: -stop.sequence } // temporary negative
        });
      }
      for (const stop of sequencedStops) {
        await tx.deliveryStop.updateMany({
          where: { batchId, shipmentId: stop.shipmentId },
          data: { sequence: stop.sequence }
        });
      }

      return tx.deliveryBatch.findUnique({
        where: { id: batchId },
        include: { stops: { orderBy: { sequence: 'asc' } } }
      });
    });
  }

  async removeStopFromBatch(batchId: string, shipmentId: string) {
    if (!this.isUuid(batchId) || !this.isUuid(shipmentId)) throw new BadRequestException('Invalid ID');

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'planning') {
        throw new BadRequestException('Cannot modify a dispatched/completed batch');
      }

      await tx.deliveryStop.delete({
        where: { shipmentId } // Using unique constraint on shipmentId
      });

      return { success: true };
    });
  }

  async dispatchBatch(batchId: string) {
    if (!this.isUuid(batchId)) throw new BadRequestException('Invalid batch ID');

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({
        where: { id: batchId },
        include: { stops: true }
      });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'planning') throw new BadRequestException('Batch is already dispatched/completed');
      if (batch.stops.length === 0) throw new BadRequestException('Cannot dispatch an empty batch');

      const updated = await tx.deliveryBatch.update({
        where: { id: batchId },
        data: {
          status: 'dispatched',
          dispatchedAt: new Date()
        }
      });

      // Update all associated shipments
      for (const stop of batch.stops) {
        await tx.shipment.update({
          where: { id: stop.shipmentId },
          data: {
            status: 'out_for_delivery',
            dispatchedAt: new Date()
          }
        });
      }

      return updated;
    });
  }

  async completeBatch(batchId: string) {
    if (!this.isUuid(batchId)) throw new BadRequestException('Invalid batch ID');

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({
        where: { id: batchId },
        include: { stops: { include: { shipment: true } } }
      });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'dispatched') throw new BadRequestException('Batch must be dispatched to complete');

      // Check if all shipments are in a terminal state
      const terminalStates = ['delivered', 'failed', 'returned'];
      const incomplete = batch.stops.filter(s => !terminalStates.includes(s.shipment.status));

      if (incomplete.length > 0) {
        throw new BadRequestException('Cannot complete batch until all shipments are in a terminal state (delivered, failed, returned)');
      }

      return tx.deliveryBatch.update({
        where: { id: batchId },
        data: {
          status: 'completed',
          completedAt: new Date()
        }
      });
    });
  }

  // --- Inventory Management (GLO-151) ---

  async getInventoryBalances(locationId: string) {
    if (!this.isUuid(locationId)) throw new BadRequestException('Invalid location ID');
    return this.prisma.inventoryBalance.findMany({
      where: { locationId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async adjustInventory(dto: AdjustInventoryDto) {
    if (!this.isUuid(dto.locationId) || !this.isUuid(dto.skuId)) {
      throw new BadRequestException('Invalid ID');
    }
    await this.getOperationalLocation(dto.locationId, FulfillmentCapability.MANAGE_OWNED_INVENTORY);
    
    return this.prisma.$transaction(async (tx) => {
      let balance = await tx.inventoryBalance.findUnique({
        where: { locationId_skuId: { locationId: dto.locationId, skuId: dto.skuId } }
      });

      if (!balance) {
        // Initialize balance
        balance = await tx.inventoryBalance.create({
          data: {
            locationId: dto.locationId,
            skuId: dto.skuId,
            ownedOnHand: 0,
            reserved: 0,
            availableToSell: 0,
            orderAllocatedExternalGoods: 0
          }
        });
      }

      // Update fields depending on the transaction type
      const updateData: Prisma.InventoryBalanceUpdateInput = {};
      
      switch (dto.type) {
        case 'RECEIVE_OWNED':
          updateData.ownedOnHand = balance.ownedOnHand + dto.quantity;
          updateData.availableToSell = balance.availableToSell + dto.quantity;
          break;
        case 'RESERVE':
          updateData.reserved = balance.reserved + dto.quantity;
          updateData.availableToSell = balance.availableToSell - dto.quantity;
          break;
        case 'RELEASE':
          updateData.reserved = balance.reserved - dto.quantity;
          updateData.availableToSell = balance.availableToSell + dto.quantity;
          break;
        case 'PICK':
          updateData.ownedOnHand = balance.ownedOnHand - dto.quantity;
          updateData.reserved = balance.reserved - dto.quantity;
          break;
        case 'ADJUST':
        case 'RETURN_TO_STOCK':
          updateData.ownedOnHand = balance.ownedOnHand + dto.quantity;
          updateData.availableToSell = balance.availableToSell + dto.quantity;
          break;
        case 'DAMAGE':
          updateData.ownedOnHand = balance.ownedOnHand - dto.quantity;
          updateData.availableToSell = balance.availableToSell - dto.quantity;
          break;
        default:
          throw new BadRequestException(`Unsupported inventory transaction type: ${dto.type}`);
      }

      // Ensure no negative availableToSell if not intended, but for MVP keep it simple
      const updatedBalance = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: updateData
      });

      const transaction = await tx.inventoryTransaction.create({
        data: {
          balanceId: balance.id,
          type: dto.type,
          quantity: dto.quantity,
          reason: dto.reason,
          actorId: dto.actorId,
          referenceId: dto.referenceId
        }
      });

      return { balance: updatedBalance, transaction };
    });
  }
}
