import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService } from '../../ordering/public';
import { CatalogService } from '../../catalog/public';
import { SupplyPlanService } from '../../sourcing/public';
import { CreateLocationDto, AllocateShipmentDto, UpdateShipmentStatusDto, StartPreparationDto, ScanItemDto, RecordShipmentEventDto, AdjustInventoryDto, ReceiveAllocatedGoodsDto, CreateDeliveryBatchDto, DeliveryStopInputDto } from '../dto/fulfillment.dto';
import { FulfillmentCapability, ShipmentStatus, PreparationSessionStatus, Prisma, Role } from '@prisma/client';
import * as crypto from 'crypto';
import { isValidShipmentBarcode, signShipmentBarcode } from './shipment-label';
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

export interface FulfillmentActor {
  id: string;
  roles: Role[];
}

// Drivers act only at the delivery stage of shipments on their own run.
const DRIVER_EVENT_TYPES = ['HANDOFF_SCANNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'];
const DRIVER_STATUSES: ShipmentStatus[] = [ShipmentStatus.out_for_delivery, ShipmentStatus.delivered, ShipmentStatus.failed];

/**
 * Forward-only shipment flow (GLO-210). `preparing` and `prepared` are entered only through the
 * preparation session (scan-verified), never through a status patch or event, so an unverified
 * order cannot be packed. Repeating the current status is a no-op.
 */
const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  pending: [ShipmentStatus.ready_to_prepare],
  ready_to_prepare: [],
  preparing: [],
  prepared: [ShipmentStatus.ready_to_pack, ShipmentStatus.packing, ShipmentStatus.packed],
  ready_to_pack: [ShipmentStatus.packing, ShipmentStatus.packed],
  packing: [ShipmentStatus.packed],
  packed: [ShipmentStatus.dispatched, ShipmentStatus.out_for_delivery],
  dispatched: [ShipmentStatus.out_for_delivery],
  out_for_delivery: [ShipmentStatus.delivered, ShipmentStatus.failed],
  failed: [ShipmentStatus.out_for_delivery, ShipmentStatus.returned],
  delivered: [ShipmentStatus.returned],
  returned: [],
};

function assertShipmentTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (from !== to && !SHIPMENT_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(`Shipment cannot move from ${from} to ${to}`);
  }
}

// Documents can be (re)printed from verified preparation until the package leaves the hub.
const PRINTABLE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.prepared, ShipmentStatus.ready_to_pack, ShipmentStatus.packing, ShipmentStatus.packed, ShipmentStatus.dispatched,
];
// Operator-confirmed print outcomes; the server never infers that paper was printed.
const PRINT_EVENT_TYPES = ['LABEL_PRINTED', 'RECEIPT_PRINTED', 'PRINT_FAILED'];

const EVENT_STATUS: Record<string, ShipmentStatus | undefined> = {
  PACKED: ShipmentStatus.packed,
  OUT_FOR_DELIVERY: ShipmentStatus.out_for_delivery,
  DELIVERED: ShipmentStatus.delivered,
  RETURNED: ShipmentStatus.returned,
  FAILED: ShipmentStatus.failed,
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

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

  private async isAssignedOperator(locationId: string, actor: FulfillmentActor): Promise<boolean> {
    if (!actor.roles.includes(Role.HUB_OPERATOR)) return false;
    return !!(await this.prisma.fulfillmentLocationOperator.findUnique({
      where: { locationId_operatorId: { locationId, operatorId: actor.id } },
    }));
  }

  /**
   * Object-level scope for a shipment (GLO-206 GAP-05): admins see everything, hub operators only
   * their assigned locations, drivers only shipments on a run assigned to them. Unassigned drivers
   * get 404 so shipment IDs cannot be probed.
   */
  private async resolveShipmentScope(shipment: { id: string; locationId: string }, actor: FulfillmentActor) {
    if (actor.roles.includes(Role.ADMIN)) return { as: 'admin' as const };
    if (await this.isAssignedOperator(shipment.locationId, actor)) return { as: 'hub' as const };
    if (actor.roles.includes(Role.DRIVER)) {
      const stop = await this.prisma.deliveryStop.findUnique({ where: { shipmentId: shipment.id }, include: { batch: true } });
      if (stop && stop.batch.driverId === actor.id) return { as: 'driver' as const, batch: stop.batch };
      throw new NotFoundException('Shipment not found');
    }
    throw new ForbiddenException('Operator is not assigned to this fulfillment location');
  }

  private async assertHubShipmentAccess(shipment: { id: string; locationId: string }, actor: FulfillmentActor) {
    const scope = await this.resolveShipmentScope(shipment, actor);
    if (scope.as === 'driver') throw new ForbiddenException('Hub access is required');
  }

  private async resolveBatchScope(batch: { locationId: string | null; driverId: string | null }, actor: FulfillmentActor) {
    if (actor.roles.includes(Role.ADMIN)) return 'admin' as const;
    if (batch.locationId && await this.isAssignedOperator(batch.locationId, actor)) return 'hub' as const;
    if (actor.roles.includes(Role.DRIVER) && batch.driverId === actor.id) return 'driver' as const;
    throw new NotFoundException('Batch not found');
  }

  private async findShipmentForActor(id: string, actor: FulfillmentActor) {
    if (!this.isUuid(id)) throw new BadRequestException('Invalid shipment ID');
    const shipment = await this.prisma.shipment.findUnique({ where: { id }, include: { items: true } });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return { shipment, scope: await this.resolveShipmentScope(shipment, actor) };
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

    try {
      return await this.prisma.shipment.create({
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
      });
    } catch (error) {
      // One order → one shipment (unique orderId): a concurrent creator already made it.
      if (!isUniqueViolation(error)) throw error;
      return this.prisma.shipment.findUniqueOrThrow({ where: { orderId: event.orderId }, include: { items: true } });
    }
  }

  async allocateShipment(dto: AllocateShipmentDto, actor: FulfillmentActor): Promise<ShipmentDetail> {
    const location = await this.getOperationalLocation(dto.locationId, FulfillmentCapability.PREPARE_ORDERS);
    await this.assertLocationAccess(location.id, actor);

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

    try {
      return await this.prisma.shipment.create({
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
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Order is already allocated to a shipment');
      throw error;
    }
  }

  async getShipment(id: string): Promise<ShipmentDetail | null> {
    if (!this.isUuid(id)) return null;
    return this.prisma.shipment.findUnique({
      where: { id },
      include: { items: true },
    });
  }

  async getShipmentForActor(id: string, actor: FulfillmentActor): Promise<ShipmentDetail> {
    return (await this.findShipmentForActor(id, actor)).shipment;
  }

  async getShipmentByOrder(orderId: string, actor: FulfillmentActor): Promise<ShipmentDetail | null> {
    if (!this.isUuid(orderId)) return null;
    const shipment = await this.prisma.shipment.findUnique({
      where: { orderId },
      include: { items: true },
    });
    if (shipment) await this.assertHubShipmentAccess(shipment, actor);
    return shipment;
  }

  async updateShipmentStatusAsActor(id: string, dto: UpdateShipmentStatusDto, actor: FulfillmentActor): Promise<ShipmentDetail> {
    const { scope } = await this.findShipmentForActor(id, actor);
    if (scope.as === 'driver') {
      if (!DRIVER_STATUSES.includes(dto.status)) throw new ForbiddenException(`Drivers cannot set shipment status ${dto.status}`);
      if (scope.batch.status !== 'dispatched') throw new BadRequestException('Delivery run has not been dispatched');
    }
    return this.updateShipmentStatus(id, dto);
  }

  async updateShipmentStatus(id: string, dto: UpdateShipmentStatusDto): Promise<ShipmentDetail> {
    const shipment = await this.getShipment(id);
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }
    assertShipmentTransition(shipment.status, dto.status);

    const updateData: Prisma.ShipmentUpdateManyMutationInput = { status: dto.status };
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
      // A failed attempt is a delivery issue, not a cancellation: the order stays open until an
      // explicit retry/return/cancel decision (retry policy pending GLO-139).
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

    // Conditional on the status just read, so a concurrent transition is not overwritten.
    const claimed = await this.prisma.shipment.updateMany({ where: { id, status: shipment.status }, data: updateData });
    if (claimed.count !== 1) throw new ConflictException('Shipment status changed concurrently; retry');
    return this.prisma.shipment.findUniqueOrThrow({ where: { id }, include: { items: true } });
  }

  async startPreparationSession(shipmentId: string, dto: StartPreparationDto, actor: FulfillmentActor) {
    if (!this.isUuid(shipmentId)) throw new BadRequestException('Invalid shipment ID');
    
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { preparationSessions: true }
    });

    if (!shipment) throw new NotFoundException('Shipment not found');
    await this.assertHubShipmentAccess(shipment, actor);
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
        data: { shipmentId, operatorId: actor.id, status: PreparationSessionStatus.in_progress }
      });
      await tx.shipmentEvent.create({ data: { shipmentId, type: 'PREPARATION_STARTED', actorId: actor.id } });
      return session;
    });
  }

  async scanItem(sessionId: string, dto: ScanItemDto, actor: FulfillmentActor) {
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
    await this.assertHubShipmentAccess(session.shipment, actor);
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

    // Count and record under a session lock so concurrent or retried scans cannot over-count (GLO-209).
    const countedSkuId = skuId;
    return this.prisma.$transaction(async tx => {
      await this.lockPreparationSession(tx, sessionId);
      const alreadyScannedCount = await tx.preparationScanEvent.count({
        where: { sessionId, skuId: countedSkuId, isSuccessful: true },
      });
      const excess = alreadyScannedCount >= expectedItem.quantity;
      return tx.preparationScanEvent.create({
        data: {
          sessionId,
          skuId: countedSkuId,
          barcodeScanned: dto.barcodeScanned,
          isSuccessful: !excess,
          ...(excess ? { errorReason: 'EXCESS_QUANTITY' } : {}),
        }
      });
    });
  }

  /** Row lock on an in-progress preparation session; scans and completion serialize on it. */
  private async lockPreparationSession(tx: Prisma.TransactionClient, sessionId: string) {
    const rows = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM "fulfillment"."shipment_preparation_sessions" WHERE id = ${sessionId}::uuid FOR UPDATE`;
    if (rows[0]?.status !== PreparationSessionStatus.in_progress) throw new BadRequestException('Session is not in progress');
  }

  async completePreparationSession(sessionId: string, actor: FulfillmentActor) {
    if (!this.isUuid(sessionId)) throw new BadRequestException('Invalid session ID');
    
    const session = await this.prisma.shipmentPreparationSession.findUnique({
      where: { id: sessionId },
      include: { 
        shipment: { include: { items: true } },
        scanEvents: true
      }
    });

    if (!session) throw new NotFoundException('Preparation session not found');
    await this.assertHubShipmentAccess(session.shipment, actor);
    if (session.status !== PreparationSessionStatus.in_progress) {
      throw new BadRequestException('Session is not in progress');
    }

    await this.prisma.$transaction(async tx => {
      await this.lockPreparationSession(tx, sessionId);
      const scans = await tx.preparationScanEvent.findMany({ where: { sessionId, isSuccessful: true } });
      const missingItems = [];
      for (const item of session.shipment.items) {
        const scannedCount = scans.filter(event => event.skuId === item.skuId).length;
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

      await tx.shipmentPreparationSession.update({
        where: { id: sessionId },
        data: {
          status: PreparationSessionStatus.completed,
          completedAt: new Date()
        }
      });
      await tx.shipment.update({
        where: { id: session.shipmentId },
        data: { status: 'prepared' }
      });
    });

    return { success: true };
  }

  /** Hub-scoped shipment + canonical order for printing; refuses non-printable or cancelled orders. */
  private async loadPrintable(shipmentId: string, actor: FulfillmentActor) {
    if (!this.isUuid(shipmentId)) throw new BadRequestException('Invalid shipment ID');
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId }, include: { items: true } });
    if (!shipment) throw new NotFoundException('Shipment not found');
    await this.assertHubShipmentAccess(shipment, actor);
    if (!PRINTABLE_STATUSES.includes(shipment.status)) {
      throw new BadRequestException(`Cannot generate label for shipment in status ${shipment.status}`);
    }
    const order = await this.orderingService.getOrder(shipment.orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'cancelled') throw new ConflictException('Order was cancelled; do not print or pack it');
    return { shipment, order };
  }

  /**
   * Label data for the external slip. Records LABEL_GENERATED only: whether paper actually printed
   * is confirmed separately (LABEL_PRINTED / PRINT_FAILED). The barcode is derived from the shipment
   * ID, so every reprint carries the same identity and never creates a new shipment (GLO-210).
   */
  async generateShipmentLabel(shipmentId: string, actor: FulfillmentActor) {
    const { shipment, order } = await this.loadPrintable(shipmentId, actor);
    const barcode = signShipmentBarcode(shipment.id);

    await this.prisma.shipmentEvent.create({
      data: { shipmentId, type: 'LABEL_GENERATED', actorId: actor.id, notes: 'Label data generated; paper print not confirmed' },
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

  /**
   * The two thermal documents for one order (GLO-210), read-only and repeatable:
   *  - customerReceipt goes inside the package: priced lines from the order snapshot, fees, discounts, COD due;
   *  - shippingSlip goes outside: shipment barcode, recipient and COD due, no item names or prices.
   * Not a tax invoice. Nothing here is recorded as printed.
   */
  async getShipmentDocuments(shipmentId: string, actor: FulfillmentActor) {
    const { shipment, order } = await this.loadPrintable(shipmentId, actor);
    const money = (n: number) => Math.round(n * 100) / 100;
    const lines = order.items.map((item) => {
      const discount = item.discountAmount && item.discountAmount > 0 ? item.discountAmount : null;
      return {
        name: item.productName ?? null,
        variant: item.variantName ?? null,
        skuCode: item.skuCode ?? null,
        quantity: item.quantity,
        unitPrice: item.price,
        discount,
        lineTotal: item.lineTotal ?? money(item.price * item.quantity),
      };
    });
    const discountTotal = money(lines.reduce((sum, line) => sum + (line.discount ?? 0), 0));
    const codDue = order.codAmount ?? order.totalAmount;
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

    return {
      shipmentId: shipment.id,
      orderNumber: order.orderNumber,
      currency: order.currency,
      customerReceipt: {
        orderNumber: order.orderNumber,
        orderedAt: order.createdAt,
        lines,
        subtotal: order.subtotal ?? money(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)),
        discountTotal: discountTotal > 0 ? discountTotal : null,
        shippingFee: order.shippingFee ?? 0,
        total: order.totalAmount,
        codDue,
      },
      shippingSlip: {
        barcode: signShipmentBarcode(shipment.id),
        orderNumber: order.orderNumber,
        recipientName: order.customerName,
        recipientPhone: order.customerPhone,
        governorate: order.governorate ?? null,
        area: order.area ?? null,
        address: order.shippingAddress,
        deliveryNotes: order.notes ?? null,
        codDue,
        packageCount: 1,
        itemCount,
      },
    };
  }

  async recordShipmentEvent(shipmentId: string, dto: RecordShipmentEventDto, actor: FulfillmentActor) {
    const { shipment, scope } = await this.findShipmentForActor(shipmentId, actor);
    if (scope.as === 'driver') {
      if (!DRIVER_EVENT_TYPES.includes(dto.type)) throw new ForbiddenException(`Drivers cannot record ${dto.type} events`);
      if (dto.type !== 'HANDOFF_SCANNED' && scope.batch.status !== 'dispatched') {
        throw new BadRequestException('Delivery run has not been dispatched');
      }
    }
    // Custody changes hands only against the physical label (GLO-206 GAP-06).
    if (dto.type === 'HANDOFF_SCANNED' && (!dto.barcode || !isValidShipmentBarcode(shipment.id, dto.barcode))) {
      throw new BadRequestException('Scanned barcode does not match this shipment');
    }

    if (dto.type === 'OUT_FOR_DELIVERY' || dto.type === 'HANDOFF_SCANNED') {
      if (shipment.status !== 'packed' && shipment.status !== 'dispatched') {
        throw new BadRequestException(`Shipment must be packed before dispatch. Current status: ${shipment.status}`);
      }
    }
    if (PRINT_EVENT_TYPES.includes(dto.type)) {
      if (scope.as === 'driver') throw new ForbiddenException(`Drivers cannot record ${dto.type} events`);
      if (!PRINTABLE_STATUSES.includes(shipment.status)) {
        throw new BadRequestException(`Cannot record printing for shipment in status ${shipment.status}`);
      }
      if (dto.type === 'LABEL_PRINTED') {
        const generated = await this.prisma.shipmentEvent.count({ where: { shipmentId, type: 'LABEL_GENERATED' } });
        if (!generated) throw new BadRequestException('Generate the shipment label before confirming it printed');
      }
    }

    if (dto.type === 'PACKED') {
      const order = await this.orderingService.getOrder(shipment.orderId);
      if (order?.status === 'cancelled') throw new ConflictException('Order was cancelled; do not print or pack it');
    }

    const newStatus = EVENT_STATUS[dto.type];
    // Reject an illegal transition before the event is persisted, so the audit trail stays truthful.
    if (newStatus) assertShipmentTransition(shipment.status, newStatus);

    const event = await this.prisma.shipmentEvent.create({
      data: {
        shipmentId,
        type: dto.type,
        actorId: actor.id,
        notes: dto.notes,
      }
    });

    if (newStatus && shipment.status !== newStatus) {
      await this.updateShipmentStatus(shipmentId, { status: newStatus });
    }

    return event;
  }

  // --- Delivery Batch Planning (GLO-149) ---

  async getEligibleShipmentsForBatching(locationId: string, actor: FulfillmentActor) {
    await this.getOperationalLocation(locationId, FulfillmentCapability.DISPATCH_SHIPMENTS);
    await this.assertLocationAccess(locationId, actor);
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

  async createDeliveryBatch(dto: CreateDeliveryBatchDto, actor: FulfillmentActor) {
    if (!this.isUuid(dto.hubId)) throw new BadRequestException('Invalid hub ID');
    const location = await this.prisma.fulfillmentLocation.findUnique({ where: { id: dto.hubId } });
    if (!location || !location.isActive) throw new NotFoundException('Active fulfillment location not found');
    await this.assertLocationAccess(location.id, actor);
    if (dto.driverId) {
      const driver = this.isUuid(dto.driverId) ? await this.prisma.customer.findUnique({ where: { id: dto.driverId } }) : null;
      if (!driver || !driver.roles.includes(Role.DRIVER)) throw new BadRequestException('driverId must reference a driver account');
    }
    return this.prisma.deliveryBatch.create({
      data: {
        id: crypto.randomUUID(),
        status: 'planning',
        locationId: location.id,
        driverId: dto.driverId,
        stops: {
          create: []
        }
      }
    });
  }

  async addStopsToBatch(batchId: string, stops: DeliveryStopInputDto[], actor: FulfillmentActor) {
    if (!this.isUuid(batchId)) throw new BadRequestException('Invalid batch ID');
    
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({ where: { id: batchId }, include: { stops: true } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (await this.resolveBatchScope(batch, actor) === 'driver') throw new ForbiddenException('Hub access is required');
      if (batch.status !== 'planning') {
        throw new BadRequestException('Cannot add stops to a dispatched/completed batch');
      }

      let currentMaxSeq = batch.stops.length > 0 ? Math.max(...batch.stops.map(s => s.sequence)) : 0;

      for (const stop of stops) {
        if (!this.isUuid(stop.shipmentId)) throw new BadRequestException('Invalid shipment ID');
        
        // Ensure shipment exists and is eligible
        const shipment = await tx.shipment.findUnique({ where: { id: stop.shipmentId }, include: { deliveryStops: true } });
        if (!shipment) throw new NotFoundException(`Shipment ${stop.shipmentId} not found`);
        if (batch.locationId && shipment.locationId !== batch.locationId) {
          throw new BadRequestException(`Shipment ${stop.shipmentId} belongs to a different hub`);
        }
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

  async updateBatchStopsSequence(batchId: string, stops: DeliveryStopInputDto[], actor: FulfillmentActor) {
    if (!this.isUuid(batchId)) throw new BadRequestException('Invalid batch ID');
    const sequencedStops = stops.map(stop => {
      if (stop.sequence === undefined) throw new BadRequestException('Stop sequence is required');
      return { shipmentId: stop.shipmentId, sequence: stop.sequence };
    });

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Batch not found');
      await this.resolveBatchScope(batch, actor);
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

  async removeStopFromBatch(batchId: string, shipmentId: string, actor: FulfillmentActor) {
    if (!this.isUuid(batchId) || !this.isUuid(shipmentId)) throw new BadRequestException('Invalid ID');

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (await this.resolveBatchScope(batch, actor) === 'driver') throw new ForbiddenException('Hub access is required');
      if (batch.status !== 'planning') {
        throw new BadRequestException('Cannot modify a dispatched/completed batch');
      }

      // Scoped to this batch: a stop on another run must not be removable through this one.
      const removed = await tx.deliveryStop.deleteMany({ where: { batchId, shipmentId } });
      if (removed.count === 0) throw new NotFoundException('Stop not found in this batch');

      return { success: true };
    });
  }

  async dispatchBatch(batchId: string, actor: FulfillmentActor) {
    if (!this.isUuid(batchId)) throw new BadRequestException('Invalid batch ID');

    const dispatched = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({
        where: { id: batchId },
        include: { stops: { include: { shipment: true } } }
      });
      if (!batch) throw new NotFoundException('Batch not found');
      if (await this.resolveBatchScope(batch, actor) === 'driver') throw new ForbiddenException('Hub access is required');
      if (batch.status !== 'planning') throw new BadRequestException('Batch is already dispatched/completed');
      if (batch.stops.length === 0) throw new BadRequestException('Cannot dispatch an empty batch');
      for (const stop of batch.stops) {
        const order = await this.orderingService.getOrder(stop.shipment.orderId);
        if (order?.status === 'cancelled') {
          throw new BadRequestException(`Order ${order.orderNumber} was cancelled; remove its stop before dispatch`);
        }
      }

      const claimed = await tx.deliveryBatch.updateMany({
        where: { id: batchId, status: 'planning' },
        data: {
          status: 'dispatched',
          dispatchedAt: new Date()
        }
      });
      if (claimed.count !== 1) throw new ConflictException('Batch was dispatched concurrently');
      const updated = await tx.deliveryBatch.findUniqueOrThrow({ where: { id: batchId } });

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

      return { updated, orderIds: batch.stops.map(stop => stop.shipment.orderId) };
    });

    // The customer order follows its shipment out of the hub (GLO-212 dispatch convergence).
    for (const orderId of dispatched.orderIds) {
      await this.orderingService.updateOrderStatus(orderId, 'shipped');
    }
    return dispatched.updated;
  }

  async completeBatch(batchId: string, actor: FulfillmentActor) {
    if (!this.isUuid(batchId)) throw new BadRequestException('Invalid batch ID');

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.deliveryBatch.findUnique({
        where: { id: batchId },
        include: { stops: { include: { shipment: true } } }
      });
      if (!batch) throw new NotFoundException('Batch not found');
      await this.resolveBatchScope(batch, actor);
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

  async getInventoryBalances(locationId: string, actor: FulfillmentActor) {
    if (!this.isUuid(locationId)) throw new BadRequestException('Invalid location ID');
    await this.assertLocationAccess(locationId, actor);
    return this.prisma.inventoryBalance.findMany({
      where: { locationId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async adjustInventory(dto: AdjustInventoryDto, actor: FulfillmentActor) {
    if (!this.isUuid(dto.locationId) || !this.isUuid(dto.skuId)) {
      throw new BadRequestException('Invalid ID');
    }
    await this.getOperationalLocation(dto.locationId, FulfillmentCapability.MANAGE_OWNED_INVENTORY);
    await this.assertLocationAccess(dto.locationId, actor);
    
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
