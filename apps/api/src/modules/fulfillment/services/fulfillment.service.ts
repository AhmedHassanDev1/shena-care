import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService, PaymentsService, ReconciliationService, navigationUrl } from '../../ordering/public';
import { CatalogService, ProductIdentityService } from '../../catalog/public';
import { PurchaseOrderService, SupplyPlanService } from '../../sourcing/public';
import { CreateLocationDto, AllocateShipmentDto, UpdateShipmentStatusDto, StartPreparationDto, ScanItemDto, RecordShipmentEventDto, AdjustInventoryDto, ReceiveAllocatedGoodsDto, CreateDeliveryBatchDto, DeliveryStopInputDto } from '../dto/fulfillment.dto';
import { FulfillmentCapability, ShipmentStatus, PreparationSessionStatus, Prisma, Role } from '@prisma/client';
import * as crypto from 'crypto';
import { isValidShipmentBarcode, signShipmentBarcode } from './shipment-label';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderDeliveredEvent } from '../../../platform/events/integration.events';
import { OutboxService } from '../../operations/services/outbox.service';
import { SupportService } from '../../operations/services/support.service';

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
// Events that prove the physical parcel is in the scanner's hands (GLO-206 GAP-06, GLO-240).
const BARCODE_EVENT_TYPES = ['HANDOFF_SCANNED', 'RECEIVED_BACK', 'RETURNED'];
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
  // failed → packed only via RECEIVED_BACK (scanned back into the hub for a later run).
  failed: [ShipmentStatus.out_for_delivery, ShipmentStatus.returned, ShipmentStatus.packed],
  delivered: [ShipmentStatus.returned],
  returned: [],
  cancelled: [],
};

// Reached only through their own commands, never through a status patch.
const COMMAND_ONLY: Array<[ShipmentStatus | '*', ShipmentStatus]> = [
  ['*', ShipmentStatus.cancelled], [ShipmentStatus.failed, ShipmentStatus.packed],
];
const CANCELLABLE: ShipmentStatus[] = [
  ShipmentStatus.pending, ShipmentStatus.ready_to_prepare, ShipmentStatus.preparing, ShipmentStatus.prepared,
  ShipmentStatus.ready_to_pack, ShipmentStatus.packing, ShipmentStatus.packed,
];

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
  RECEIVED_BACK: ShipmentStatus.packed,
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
    private readonly reconciliation: ReconciliationService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly support: SupportService,
    private readonly payments: PaymentsService,
    private readonly identity: ProductIdentityService,
  ) {}

  /**
   * Physical identity evidence for one unit/line (GLO-242): a scanned manufacturer barcode resolved
   * through the SKU's primary code or a reviewed alias, or an explicit manual verification with a
   * reason and every identity check. Unknown/retired codes need review; codes naming two SKUs are
   * ambiguous; nothing here mutates the catalog.
   */
  private async checkUnitIdentity(input: { barcodeScanned?: string; skuId?: string; manualReason?: string; manualChecks?: string[] }):
    Promise<{ ok: true; skuId: string; method: 'primary_barcode' | 'barcode_alias' | 'manual' } | { ok: false; code: 'PRODUCT_IDENTITY_REVIEW_REQUIRED' | 'PRODUCT_IDENTITY_AMBIGUOUS' }> {
    const manual = input.manualReason !== undefined || input.manualChecks !== undefined;
    if (input.barcodeScanned && manual) throw new BadRequestException('Use either a barcode scan or a manual verification, not both');
    if (input.barcodeScanned) {
      const resolved = await this.identity.resolveBarcode(input.barcodeScanned);
      if (resolved.status === 'unknown') return { ok: false, code: 'PRODUCT_IDENTITY_REVIEW_REQUIRED' };
      if (resolved.status === 'ambiguous') return { ok: false, code: 'PRODUCT_IDENTITY_AMBIGUOUS' };
      return { ok: true, skuId: resolved.skuId, method: resolved.via };
    }
    if (!manual || !input.skuId) throw new BadRequestException('Scan the product barcode or record a manual identity verification');
    const checks = new Set(input.manualChecks ?? []);
    if (!input.manualReason?.trim() || !['brand', 'variant', 'size', 'pack'].every(check => checks.has(check))) {
      throw new BadRequestException('A manual identity verification needs a reason and all checks: brand, variant, size, pack');
    }
    return { ok: true, skuId: input.skuId, method: 'manual' };
  }

  /**
   * A driver completing a cash-on-delivery stop declares the cash received (custody). Hub/admin
   * corrections never carry a declaration; counting and settlement happen at the hub (GLO-214).
   * Runs inside the delivery transaction, after the shipment claim (GLO-236 D-1).
   */
  private async declareDeliveryCash(tx: Prisma.TransactionClient, orderId: string, as: 'admin' | 'hub' | 'driver', actor: FulfillmentActor, amount?: number) {
    if (as !== 'driver') {
      if (amount !== undefined) throw new BadRequestException('Only the delivering driver declares collected cash');
      return;
    }
    const collection = await this.reconciliation.ensureExpectedCollection(orderId, tx);
    if (!collection) {
      if (amount) throw new BadRequestException('This order has no cash to collect');
      return;
    }
    if (amount === undefined) {
      throw new BadRequestException('Declare the cash collected (collectedAmount) to complete a cash-on-delivery stop');
    }
    await this.reconciliation.recordDriverDeclaration(orderId, actor.id, amount, tx);
  }

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

  /** Hubs an operator works at; admins are unrestricted ('all'). Used to scope cash counts. */
  async operatorLocationIds(actor: FulfillmentActor): Promise<string[] | 'all'> {
    if (actor.roles.includes(Role.ADMIN)) return 'all';
    if (!actor.roles.includes(Role.HUB_OPERATOR)) return [];
    const rows = await this.prisma.fulfillmentLocationOperator.findMany({ where: { operatorId: actor.id }, select: { locationId: true } });
    return rows.map(row => row.locationId);
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
      // The shipment's latest attempt decides: a later run of another driver ends this driver's access.
      const stop = await this.prisma.deliveryStop.findFirst({ where: { shipmentId: shipment.id }, orderBy: { createdAt: 'desc' }, include: { batch: true } });
      if (stop && stop.batch.driverId === actor.id) return { as: 'driver' as const, batch: stop.batch, stop };
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
      // Held, not received: the physical fact is recorded as a receiving exception for a human decision.
      const supportCase = await this.prisma.$transaction(tx => this.support.openOperationalException(tx, {
        dedupKey: `receiving:${dto.idempotencyKey}`, category: 'sourcing', priority: 'high', orderId: dto.orderId,
        title: `Receiving exception — ${dto.condition} goods`,
        description: `${dto.quantity} unit(s) of SKU ${dto.skuId} arrived ${dto.condition} for allocation ${dto.allocationId}. Not received; decide return/replacement with the supplier.`,
      }));
      throw new BadRequestException({ code: 'RECEIVING_EXCEPTION', caseId: supportCase.id,
        message: `Goods in ${dto.condition} condition cannot be allocated to an order` });
    }
    const unit = await this.checkUnitIdentity({ ...dto, skuId: dto.barcodeScanned ? undefined : dto.skuId });
    if (!unit.ok) throw new ConflictException({ code: unit.code, message: 'The scanned code does not identify a reviewed product; verify it manually or ask catalog review' });
    if (unit.skuId !== dto.skuId) {
      throw new ConflictException({ code: 'PRODUCT_IDENTITY_MISMATCH', message: 'The scanned product is not the allocated SKU' });
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
          identityMethod: unit.method,
          barcodeScanned: dto.barcodeScanned ?? null,
          identityNote: unit.method === 'manual' ? dto.manualReason : null,
          actorId: actor.id,
          inventoryTransactionId: inventoryTransaction.id,
        },
      });
      // Physical arrival is counted on the supplier PO line lineage (GLO-237); only the Hub receives.
      await this.purchaseOrders.recordAllocationReceipt(tx, dto.allocationId, dto.quantity);

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
      // The order is being prepared from the first physical receipt, in the same transaction.
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (current.status === 'placed' || current.status === 'confirmed') {
        await this.orderingService.transitionInTx(tx, order.id, 'packing');
      } else if (current.status !== 'packing') {
        throw new ConflictException(`Order cannot receive goods in status ${current.status}`);
      }
      return created;
    }, { timeout: 30000 });

    return this.presentReceipt(receipt, allocation.confirmedQuantity);
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

    try {
      return await this.prisma.$transaction(async tx => {
        const shipment = await tx.shipment.create({
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
        await this.orderingService.transitionInTx(tx, order.id, 'packing');
        return shipment;
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
    const { shipment, scope } = await this.findShipmentForActor(id, actor);
    if (scope.as === 'driver') {
      if (!DRIVER_STATUSES.includes(dto.status)) throw new ForbiddenException(`Drivers cannot set shipment status ${dto.status}`);
      if (scope.batch.status !== 'dispatched') throw new BadRequestException('Delivery run has not been dispatched');
      if (scope.stop.status !== 'active' && dto.status !== shipment.status) {
        throw new ConflictException('This delivery attempt has ended; only the hub can act on the parcel now');
      }
    }
    if (dto.status !== ShipmentStatus.delivered && dto.collectedAmount !== undefined) {
      throw new BadRequestException('collectedAmount is only recorded with a delivery');
    }
    if (COMMAND_ONLY.some(([from, to]) => to === dto.status && (from === '*' || from === shipment.status) && shipment.status !== dto.status)) {
      throw new ConflictException(dto.status === ShipmentStatus.cancelled
        ? 'Cancel the order instead; its shipment is cancelled with it'
        : 'Scan the parcel back into the hub (RECEIVED_BACK) to make it available for another run');
    }
    if (dto.status === ShipmentStatus.returned && shipment.status !== dto.status) {
      throw new BadRequestException('Record RETURNED as a shipment event with the parcel barcode');
    }
    if (dto.status === ShipmentStatus.failed && shipment.status !== dto.status && !dto.reasonCode) {
      throw new BadRequestException('A failed delivery needs a reasonCode');
    }
    if (dto.reasonCode && dto.status !== ShipmentStatus.failed) throw new BadRequestException('reasonCode is only recorded with a failed delivery');
    assertShipmentTransition(shipment.status, dto.status);
    return this.updateShipmentStatus(id, { status: dto.status, trackingNumber: dto.trackingNumber },
      { as: scope.as, actor, collectedAmount: dto.collectedAmount,
        ...(dto.status === ShipmentStatus.failed ? { event: { type: 'FAILED', reasonCode: dto.reasonCode } } : {}) });
  }

  /**
   * One transaction per transition (GLO-236 D-1): the shipment is claimed conditionally on the
   * status just read *before* any effect, then the order transition, cash declaration, shipment
   * event and notifications commit with it — a losing concurrent writer changes nothing.
   */
  async updateShipmentStatus(id: string, dto: UpdateShipmentStatusDto, context?: {
    as: 'admin' | 'hub' | 'driver'; actor: FulfillmentActor; collectedAmount?: number;
    event?: { type: string; notes?: string; reasonCode?: string };
  }): Promise<ShipmentDetail> {
    const result = await this.prisma.$transaction(async tx => {
      const shipment = await tx.shipment.findUnique({ where: { id }, include: { items: true } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      assertShipmentTransition(shipment.status, dto.status);

      const updateData: Prisma.ShipmentUpdateManyMutationInput = { status: dto.status };
      if (dto.trackingNumber !== undefined) updateData.trackingNumber = dto.trackingNumber;
      const entering = shipment.status !== dto.status;
      const now = new Date();
      if (dto.status === ShipmentStatus.dispatched && !shipment.dispatchedAt) updateData.dispatchedAt = now;
      if (dto.status === ShipmentStatus.delivered && !shipment.deliveredAt) updateData.deliveredAt = now;

      const claimed = await tx.shipment.updateMany({ where: { id, status: shipment.status }, data: updateData });
      if (claimed.count !== 1) throw new ConflictException('Shipment status changed concurrently; retry');

      if (context?.event) {
        await tx.shipmentEvent.create({ data: {
          shipmentId: id, type: context.event.type, actorId: context.actor.id, notes: context.event.notes, reasonCode: context.event.reasonCode,
        } });
      }
      let delivered: OrderDeliveredEvent | null = null;
      if (entering) {
        const order = await tx.order.findUnique({ where: { id: shipment.orderId } });
        if (!order) throw new NotFoundException('Order not found');
        const notify = (eventType: string, templateId: string, payload: Record<string, unknown>) =>
          this.outbox.enqueue(tx, {
            eventType, aggregateId: shipment.id, aggregateType: 'Shipment', customerId: order.customerId || undefined,
            payload: { orderId: order.id, orderNumber: order.orderNumber, ...payload }, channelIntent: 'whatsapp', templateId,
            deduplicationKey: `${eventType}:${shipment.id}:${shipment.updatedAt.getTime()}`,
          });

        if (dto.status === ShipmentStatus.dispatched) {
          await this.orderingService.transitionInTx(tx, shipment.orderId, 'shipped');
        } else if (dto.status === ShipmentStatus.out_for_delivery) {
          await notify('shipment.out_for_delivery', 'out_for_delivery_v1', { trackingNumber: shipment.trackingNumber });
        } else if (dto.status === ShipmentStatus.delivered) {
          // Delivery of a cash-on-delivery order is recorded only with the driver's door-cash
          // declaration; a staff status change can never make cash look collected (GLO-238 F4).
          if ((context?.as ?? 'admin') !== 'driver' && (order.codAmount ?? order.totalAmount).greaterThan(0)) {
            throw new ConflictException({ code: 'COD_DELIVERY_REQUIRES_DRIVER',
              message: 'A cash-on-delivery order is delivered only by its assigned driver with the declared cash' });
          }
          await this.declareDeliveryCash(tx, shipment.orderId, context?.as ?? 'admin',
            context?.actor ?? { id: 'system', roles: [] }, context?.collectedAmount);
          await this.orderingService.transitionInTx(tx, shipment.orderId, 'delivered');
          await notify('shipment.delivered', 'delivered_v1', {});
          delivered = new OrderDeliveredEvent(order.id, order.customerId || 'unknown',
            shipment.items.map(i => ({ productId: i.skuId })), shipment.deliveredAt ?? now);
          await this.closeActiveStop(tx, id, 'delivered');
        } else if (dto.status === ShipmentStatus.failed) {
          // A failed attempt is a delivery issue, not a cancellation: the order stays open until an
          // explicit retry/return/cancel decision (retry count policy pending GLO-139).
          await notify('shipment.failed', 'delivery_failed_v1', { reason: context?.event?.reasonCode ?? 'OTHER' });
        } else if (dto.status === ShipmentStatus.packed && shipment.status === ShipmentStatus.failed) {
          // Back in the hub's hands: this attempt is history; the parcel can join a later run.
          await this.closeActiveStop(tx, id, 'failed');
        } else if (dto.status === ShipmentStatus.returned && shipment.status === ShipmentStatus.failed) {
          // Never delivered and given up: the order ends as returned, no cash is due, and what to do
          // with the goods (restock / back to supplier) is a recorded human decision.
          await this.closeActiveStop(tx, id, 'returned');
          await this.orderingService.transitionInTx(tx, shipment.orderId, 'returned');
          await this.reconciliation.voidExpectedCollection(tx, shipment.orderId);
          await this.support.openOperationalException(tx, {
            dedupKey: `returned:${id}`, category: 'delivery', priority: 'high', orderId: order.id,
            title: `Returned undelivered — ${order.orderNumber}`,
            description: 'Parcel came back to the hub undelivered. Decide stock disposition (restock / return to supplier) and customer follow-up.',
          });
          await notify('shipment.returned', 'returned_to_sender_v1', {});
        }
      }
      return { shipment: await tx.shipment.findUniqueOrThrow({ where: { id }, include: { items: true } }), delivered };
    });

    // Advisory, in-process only (Care lifecycle); emitted after commit so it never reports a rolled-back delivery.
    if (result.delivered) this.eventEmitter.emit('order.delivered', result.delivered);
    return result.shipment;
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

    // Identity first (GLO-242): reviewed barcode or audited manual check; unknown/ambiguous is recorded, never guessed.
    const unit = await this.checkUnitIdentity(dto);
    const evidence = { barcodeScanned: dto.barcodeScanned, operatorId: actor.id,
      manualReason: dto.barcodeScanned ? null : dto.manualReason ?? null };
    if (!unit.ok) {
      return this.prisma.preparationScanEvent.create({ data: { sessionId, ...evidence, isSuccessful: false, errorReason: unit.code } });
    }
    const skuId = unit.skuId;

    const expectedItem = session.shipment.items.find(item => item.skuId === skuId);

    if (!expectedItem) {
      return this.prisma.preparationScanEvent.create({
        data: {
          sessionId,
          skuId,
          ...evidence,
          verificationMethod: unit.method,
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
          ...evidence,
          verificationMethod: unit.method,
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
      if (scope.stop.status !== 'active' && EVENT_STATUS[dto.type] !== shipment.status) {
        throw new ConflictException('This delivery attempt has ended; only the hub can act on the parcel now');
      }
      if (dto.type !== 'HANDOFF_SCANNED' && scope.batch.status !== 'dispatched') {
        throw new BadRequestException('Delivery run has not been dispatched');
      }
    }
    // Custody changes hands only against the physical label (GLO-206 GAP-06, GLO-240).
    if (BARCODE_EVENT_TYPES.includes(dto.type) && (!dto.barcode || !isValidShipmentBarcode(shipment.id, dto.barcode))) {
      throw new BadRequestException('Scanned barcode does not match this shipment');
    }
    if (dto.type === 'FAILED' && !dto.reasonCode) throw new BadRequestException('A failed delivery needs a reasonCode');
    if (dto.reasonCode && dto.type !== 'FAILED') throw new BadRequestException('reasonCode is only recorded with a failed delivery');
    if ((dto.type === 'RECEIVED_BACK' || dto.type === 'RETURNED') && scope.as === 'driver') {
      throw new ForbiddenException(`Only the hub records ${dto.type}`);
    }

    if (dto.type === 'HANDOFF_SCANNED') {
      // Custody is taken once per delivery attempt; a replayed scan (retry, double tap, flaky
      // network) returns the original record of this attempt.
      const attempt = await this.prisma.deliveryStop.findFirst({ where: { shipmentId, status: 'active' } });
      const existing = await this.prisma.shipmentEvent.findFirst({
        where: { shipmentId, type: 'HANDOFF_SCANNED', ...(attempt ? { createdAt: { gte: attempt.createdAt } } : {}) },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) return existing;
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
    // Reject an illegal transition before anything is persisted, so the audit trail stays truthful.
    if (newStatus) assertShipmentTransition(shipment.status, newStatus);
    if (dto.type !== 'DELIVERED' && dto.collectedAmount !== undefined) {
      throw new BadRequestException('collectedAmount is only recorded with a delivery');
    }

    if (newStatus && shipment.status === newStatus) {
      // Replay of an already-applied outcome (retry, double tap): no second event or effect. A
      // delivery replay must repeat the same declaration, otherwise it is a conflicting rewrite.
      if (dto.type === 'DELIVERED' && scope.as === 'driver') {
        await this.prisma.$transaction(tx => this.declareDeliveryCash(tx, shipment.orderId, scope.as, actor, dto.collectedAmount));
      }
      const prior = await this.prisma.shipmentEvent.findFirst({ where: { shipmentId, type: dto.type }, orderBy: { createdAt: 'desc' } });
      if (prior) return prior;
    }

    if (newStatus && shipment.status !== newStatus) {
      await this.updateShipmentStatus(shipmentId, { status: newStatus },
        { as: scope.as, actor, collectedAmount: dto.collectedAmount, event: { type: dto.type, notes: dto.notes, reasonCode: dto.reasonCode } });
      return this.prisma.shipmentEvent.findFirstOrThrow({ where: { shipmentId, type: dto.type }, orderBy: { createdAt: 'desc' } });
    }

    return this.prisma.shipmentEvent.create({
      data: {
        shipmentId,
        type: dto.type,
        actorId: actor.id,
        notes: dto.notes,
      }
    });
  }

  /**
   * The driver's own active runs (planning or dispatched), stops in sequence, with only what a stop
   * needs: recipient, address, COD due and item count — no item names, prices or other drivers' stops
   * (GLO-212 / GLO-220). `handedOver` means the label was scanned into the driver's custody.
   */
  async getDriverManifest(actor: FulfillmentActor) {
    if (!actor.roles.includes(Role.DRIVER)) throw new ForbiddenException('Driver access is required');
    const batches = await this.prisma.deliveryBatch.findMany({
      where: { driverId: actor.id, status: { in: ['planning', 'dispatched'] } },
      orderBy: { createdAt: 'asc' },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: { shipment: { include: { events: { where: { type: 'HANDOFF_SCANNED' }, select: { createdAt: true } } } } },
        },
      },
    });

    const declared = await this.reconciliation.getDeclaredCash(
      batches.flatMap((batch) => batch.stops.map((stop) => stop.shipment.orderId)));

    return Promise.all(batches.map(async (batch) => ({
      id: batch.id,
      status: batch.status,
      dispatchedAt: batch.dispatchedAt,
      stops: await Promise.all(batch.stops.map(async (stop) => {
        const order = await this.orderingService.getOrder(stop.shipment.orderId);
        if (!order) throw new NotFoundException('Order not found');
        return {
          sequence: stop.sequence,
          shipmentId: stop.shipmentId,
          status: stop.shipment.status,
          attemptStatus: stop.status,
          handedOver: stop.shipment.events.some(event => event.createdAt >= stop.createdAt),
          orderNumber: order.orderNumber,
          recipientName: order.customerName,
          recipientPhone: order.customerPhone,
          governorate: order.governorate ?? null,
          area: order.area ?? null,
          address: order.shippingAddress,
          deliveryNotes: order.notes ?? null,
          // Only the assigned driver's own stops reach this view (GLO-231 secured coordinates).
          location: order.latitude != null && order.longitude != null ? {
            latitude: order.latitude, longitude: order.longitude, source: order.locationSource ?? null,
            navigationUrl: navigationUrl(order.latitude, order.longitude),
          } : null,
          codDue: order.codAmount ?? order.totalAmount,
          cashDeclared: declared.get(order.id) ?? null,
          currency: order.currency,
          itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        };
      })),
    })));
  }

  private async closeActiveStop(tx: Prisma.TransactionClient, shipmentId: string, status: 'delivered' | 'failed' | 'returned') {
    await tx.deliveryStop.updateMany({ where: { shipmentId, status: 'active' }, data: { status, closedAt: new Date() } });
  }

  /**
   * Owner command inside the composed order-cancellation transaction (GLO-240): a shipment that has
   * not left the hub is cancelled (with its planning stop removed); one in a driver's custody or on a
   * dispatched run refuses. Returns whether goods were already received for the order.
   */
  async cancelShipmentForOrder(tx: Prisma.TransactionClient, orderId: string, actorId: string): Promise<{ goodsReceived: boolean }> {
    const shipment = await tx.shipment.findUnique({ where: { orderId }, include: { deliveryStops: { where: { status: 'active' }, include: { batch: true } } } });
    const receipts = await tx.fulfillmentReceipt.count({ where: { orderId } });
    if (!shipment) return { goodsReceived: receipts > 0 };
    if (!CANCELLABLE.includes(shipment.status) || shipment.deliveryStops.some(stop => stop.batch.status !== 'planning')) {
      throw new ConflictException({ code: 'CANCELLATION_TOO_LATE', message: `The parcel is already ${shipment.status}; use the delivery return flow` });
    }
    await tx.deliveryStop.deleteMany({ where: { shipmentId: shipment.id, status: 'active', batch: { status: 'planning' } } });
    const claimed = await tx.shipment.updateMany({ where: { id: shipment.id, status: shipment.status }, data: { status: ShipmentStatus.cancelled } });
    if (claimed.count !== 1) throw new ConflictException('Shipment changed concurrently; retry');
    await tx.shipmentPreparationSession.updateMany({ where: { shipmentId: shipment.id, status: PreparationSessionStatus.in_progress }, data: { status: PreparationSessionStatus.failed, completedAt: new Date() } });
    await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, type: 'ORDER_CANCELLED', actorId } });
    return { goodsReceived: receipts > 0 };
  }

  /**
   * A run only carries stops a driver can navigate to (confirmed pin, GLO-231) and that are paid or
   * cash on delivery: an unconfirmed card/wallet payment never leaves the hub (GLO-241).
   */
  private async assertDeliveryPin(orderId: string) {
    const order = await this.orderingService.getOrder(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (!(await this.payments.isPaymentSatisfied(orderId))) {
      throw new ConflictException({ code: 'PAYMENT_NOT_CONFIRMED', message: `Order ${order.orderNumber} is not paid yet` });
    }
    if (order.latitude === null || order.latitude === undefined || order.longitude === null || order.longitude === undefined) {
      throw new ConflictException({
        code: 'LOCATION_REQUIRED',
        message: `Order ${order.orderNumber} has no confirmed delivery pin; correct its delivery location first`,
      });
    }
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
        deliveryStops: { none: { status: 'active' } }
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
    try {
      return await this.addStopsInTx(batchId, stops, actor);
    } catch (error) {
      // Two runs racing for one parcel: the partial unique index keeps one active attempt (GLO-240).
      if (isUniqueViolation(error)) throw new BadRequestException('Shipment is already assigned to a batch');
      throw error;
    }
  }

  private async addStopsInTx(batchId: string, stops: DeliveryStopInputDto[], actor: FulfillmentActor) {
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
        
        // Ensure shipment exists and is eligible (packed, no active attempt on any run)
        const shipment = await tx.shipment.findUnique({ where: { id: stop.shipmentId }, include: { deliveryStops: { where: { status: 'active' } } } });
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
        await this.assertDeliveryPin(shipment.orderId);

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
        await this.assertDeliveryPin(stop.shipment.orderId);
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

      // Shipments, orders and expected cash leave the hub together or not at all (GLO-236 D-2).
      for (const stop of batch.stops) {
        const moved = await tx.shipment.updateMany({
          where: { id: stop.shipmentId, status: 'packed' },
          data: { status: 'out_for_delivery', dispatchedAt: new Date() },
        });
        if (moved.count !== 1) throw new ConflictException(`Shipment ${stop.shipmentId} is no longer packed; re-plan the run`);
        // The customer order follows its shipment out of the hub (GLO-212 dispatch convergence).
        await this.orderingService.transitionInTx(tx, stop.shipment.orderId, 'shipped');
        // The cash each stop should bring back is fixed when the run leaves the hub (GLO-214).
        await this.reconciliation.ensureExpectedCollection(stop.shipment.orderId, tx, batch.locationId);
      }

      return updated;
    }, { timeout: 30000 });

    return dispatched;
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

      // Every attempt on the run ended: closed (delivered / back at hub / returned) or failed in hand.
      const terminalStates = ['delivered', 'failed', 'returned'];
      const incomplete = batch.stops.filter(s => s.status === 'active' && !terminalStates.includes(s.shipment.status));

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

  // --- Hub work queues (GLO-239): read-only, scoped to an assigned hub, no customer PII ---

  /** Confirmed supplier lineage still to arrive, for orders this hub can receive (no shipment elsewhere). */
  async getReceivables(locationId: string, actor: FulfillmentActor) {
    await this.getOperationalLocation(locationId, FulfillmentCapability.RECEIVE_SUPPLIER_GOODS);
    await this.assertLocationAccess(locationId, actor);
    const links = await this.purchaseOrders.listReceivableLinks();
    const shipments = await this.prisma.shipment.findMany({ where: { orderId: { in: links.map(l => l.orderId) } }, select: { orderId: true, locationId: true, status: true } });
    const elsewhere = new Set(shipments.filter(s => s.locationId !== locationId || !['pending', 'ready_to_prepare'].includes(s.status)).map(s => s.orderId));
    const mine = links.filter(link => !elsewhere.has(link.orderId));
    const [orders, skus] = await Promise.all([
      this.orderingService.getOrderSummaries(mine.map(l => l.orderId)),
      Promise.all([...new Set(mine.map(l => l.skuId))].map(id => this.catalogService.getSkuIdentity(id))),
    ]);
    const skuById = new Map(skus.filter(Boolean).map(sku => [sku!.id, sku!]));
    return mine.filter(link => { const o = orders.get(link.orderId); return o && ['placed', 'confirmed', 'packing'].includes(o.status); })
      .map(link => ({
        ...link,
        orderNumber: orders.get(link.orderId)!.orderNumber,
        skuCode: skuById.get(link.skuId)?.code ?? null,
        variantName: skuById.get(link.skuId)?.variantName ?? null,
        barcode: skuById.get(link.skuId)?.barcode ?? null,
      }));
  }

  /** Preparation / packing / dispatch queue of one hub, with the active delivery attempt if any. */
  async listHubShipments(locationId: string, actor: FulfillmentActor, filter: { statuses?: ShipmentStatus[]; take: number; skip: number }) {
    if (!this.isUuid(locationId)) throw new BadRequestException('Invalid location ID');
    await this.assertLocationAccess(locationId, actor);
    const where: Prisma.ShipmentWhereInput = { locationId, ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.shipment.count({ where }),
      this.prisma.shipment.findMany({ where, orderBy: { updatedAt: 'asc' }, take: filter.take, skip: filter.skip,
        include: { items: true, deliveryStops: { where: { status: 'active' }, select: { batchId: true, sequence: true } } } }),
    ]);
    const orders = await this.orderingService.getOrderSummaries(rows.map(r => r.orderId));
    return { total, items: rows.map(row => ({
      shipmentId: row.id, orderId: row.orderId, orderNumber: orders.get(row.orderId)?.orderNumber ?? null,
      orderStatus: orders.get(row.orderId)?.status ?? null, governorate: orders.get(row.orderId)?.governorate ?? null,
      area: orders.get(row.orderId)?.area ?? null, status: row.status,
      itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
      activeRun: row.deliveryStops[0] ?? null, updatedAt: row.updatedAt,
    })) };
  }

  /** Delivery runs of one hub (planning / dispatched / completed) with attempt counts. */
  async listHubRuns(locationId: string, actor: FulfillmentActor, filter: { statuses?: string[]; take: number; skip: number }) {
    if (!this.isUuid(locationId)) throw new BadRequestException('Invalid location ID');
    await this.assertLocationAccess(locationId, actor);
    const where: Prisma.DeliveryBatchWhereInput = { locationId, ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.deliveryBatch.count({ where }),
      this.prisma.deliveryBatch.findMany({ where, orderBy: { createdAt: 'desc' }, take: filter.take, skip: filter.skip,
        include: { stops: { select: { status: true } } } }),
    ]);
    return { total, items: rows.map(run => ({
      id: run.id, status: run.status, driverId: run.driverId, plannedAt: run.plannedAt, dispatchedAt: run.dispatchedAt, completedAt: run.completedAt,
      stops: run.stops.length,
      attempts: run.stops.reduce<Record<string, number>>((acc, stop) => ({ ...acc, [stop.status]: (acc[stop.status] ?? 0) + 1 }), {}),
    })) };
  }

  /** Failed delivery attempts awaiting the hub (admin attention queue). */
  async listFailedDeliveries(paging: { take: number; skip: number }) {
    const where = { status: ShipmentStatus.failed };
    const [total, rows] = await Promise.all([
      this.prisma.shipment.count({ where }),
      this.prisma.shipment.findMany({ where, orderBy: { updatedAt: 'asc' }, take: paging.take, skip: paging.skip,
        include: { events: { where: { type: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 1 } } }),
    ]);
    return { total, items: rows.map(row => ({
      shipmentId: row.id, orderId: row.orderId, locationId: row.locationId,
      reasonCode: row.events[0]?.reasonCode ?? null, failedAt: row.events[0]?.createdAt ?? row.updatedAt,
    })) };
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
