import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService } from '../../ordering/public';
import { CatalogService } from '../../catalog/public';
import { DeskScanDto } from '../dto/hub-desk.dto';
import { FulfillmentActor, FulfillmentService } from './fulfillment.service';

/** Shipments the one-person desk still works on: receiving, verification, packaging and printing. */
const DESK_SHIPMENT_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.pending, ShipmentStatus.ready_to_prepare, ShipmentStatus.preparing,
  ShipmentStatus.prepared, ShipmentStatus.ready_to_pack, ShipmentStatus.packing,
];
const OPEN_ORDER_STATUSES = ['placed', 'confirmed', 'packing'];
const PRINT_EVENTS = ['LABEL_GENERATED', 'LABEL_PRINTED', 'RECEIPT_PRINTED', 'PRINT_FAILED'];

export type DeskStage = 'waiting_purchase' | 'receiving' | 'verifying' | 'packing';
export type DeskScanOutcome = 'received' | 'verified' | 'rejected';
export type DeskRejectCode =
  | 'PRODUCT_IDENTITY_REVIEW_REQUIRED' | 'PRODUCT_IDENTITY_AMBIGUOUS' | 'WRONG_ITEM'
  | 'ALREADY_COMPLETE' | 'NOT_PURCHASED_YET' | 'ORDER_NOT_OPEN' | 'PACKING_STARTED';

export interface DeskLine {
  orderItemId: string; skuId: string; productName: string | null; brandName: string | null; variantName: string | null
  skuCode: string | null; barcode: string | null; imageUrl: string | null
  /** Units the customer ordered. */
  required: number
  /** Units recorded as bought on the Purchases checklist (received + still awaiting the scan). Not a physical fact. */
  purchased: number
  /** Units physically scanned in at the Hub against this order line. */
  received: number
  /** Units counted by the preparation verification. */
  verified: number
}

export interface DeskOrder {
  orderId: string; orderNumber: string; orderStatus: string; placedAt: Date; governorate: string | null; area: string | null
  shipment: { id: string; status: ShipmentStatus } | null
  stage: DeskStage
  lines: DeskLine[]
  printEvents: string[]
}

/**
 * One-person Hub desk (GLO-315): every open order of the Hub with its exact SKU lines and the four
 * counts that matter (ordered, bought, physically received, verified), and ONE scan action that
 * receives a unit against its order line and, through that same scan, verifies it for the order.
 * Purchases recorded on the checklist are never treated as receipt; only a scan here is.
 * Reuses the owner commands (receiveAllocatedGoods, verifyPreparationFromReceipts): no parallel
 * stock or preparation records.
 */
@Injectable()
export class HubDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
    private readonly ordering: OrderingService,
    private readonly catalog: CatalogService,
  ) {}

  async getDesk(locationId: string, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const [receivables, shipments] = await Promise.all([
      this.fulfillment.getReceivables(locationId, actor),
      this.prisma.shipment.findMany({
        where: { locationId, status: { in: DESK_SHIPMENT_STATUSES } },
        include: {
          items: true,
          preparationSessions: { orderBy: { startedAt: 'desc' }, take: 1, include: { scanEvents: { where: { isSuccessful: true }, select: { skuId: true } } } },
          events: { where: { type: { in: PRINT_EVENTS } }, select: { type: true } },
        },
      }),
    ]);
    const orderIds = [...new Set([...receivables.map(r => r.orderId), ...shipments.map(s => s.orderId)])];
    const [orders, receipts] = await Promise.all([
      Promise.all(orderIds.map(id => this.ordering.getOrder(id))),
      this.prisma.fulfillmentReceipt.groupBy({ by: ['orderItemId'], where: { orderId: { in: orderIds } }, _sum: { quantity: true } }),
    ]);
    const receivedByItem = new Map(receipts.map(row => [row.orderItemId, row._sum.quantity ?? 0]));
    const awaitingByItem = new Map<string, number>();
    for (const r of receivables) awaitingByItem.set(r.orderItemId, (awaitingByItem.get(r.orderItemId) ?? 0) + r.remainingQuantity);
    const shipmentByOrder = new Map(shipments.map(s => [s.orderId, s]));
    const open = orders.filter((o): o is NonNullable<typeof o> => !!o && OPEN_ORDER_STATUSES.includes(o.status));
    const labels = await this.catalog.getSkuLabels(open.flatMap(o => o.items.map(i => i.skuId)));

    const result: DeskOrder[] = open.map(order => {
      const shipment = shipmentByOrder.get(order.id) ?? null;
      const scans = shipment?.preparationSessions[0]?.scanEvents ?? [];
      const lines: DeskLine[] = order.items.map(item => {
        const label = labels.get(item.skuId);
        const received = receivedByItem.get(item.id) ?? 0;
        return {
          orderItemId: item.id, skuId: item.skuId, productName: label?.productName ?? item.productName ?? null,
          brandName: label?.brandName ?? null, variantName: label?.variantName ?? item.variantName ?? null,
          skuCode: label?.skuCode ?? item.skuCode ?? null, barcode: label?.barcode ?? null, imageUrl: label?.imageUrl ?? null,
          required: item.quantity, purchased: received + (awaitingByItem.get(item.id) ?? 0), received,
          verified: Math.min(scans.filter(scan => scan.skuId === item.skuId).length, item.quantity),
        };
      });
      return {
        orderId: order.id, orderNumber: order.orderNumber, orderStatus: order.status, placedAt: order.createdAt,
        governorate: order.governorate ?? null, area: order.area ?? null,
        shipment: shipment ? { id: shipment.id, status: shipment.status } : null,
        stage: this.stageOf(shipment?.status ?? null, lines),
        lines,
        printEvents: [...new Set(shipment?.events.map(e => e.type) ?? [])],
      };
    });
    const order: Record<DeskStage, number> = { receiving: 0, verifying: 1, packing: 2, waiting_purchase: 3 };
    result.sort((a, b) => order[a.stage] - order[b.stage] || +new Date(a.placedAt) - +new Date(b.placedAt));
    return { orders: result, lastLots: await this.lastLots(locationId, open.flatMap(o => o.items.map(i => i.skuId))) };
  }

  /**
   * One physical scan at the desk. Identity is resolved first (reviewed barcode/alias or audited manual
   * check). A unit the Purchases checklist recorded as bought and not yet scanned is received against
   * its exact order line (one unit per scan, idempotent on clientScanId); when the order is fully in,
   * the same receipt scans verify it and preparation completes. Wrong, unknown, duplicate and
   * not-yet-bought scans change nothing and are logged on the shipment when one exists.
   */
  async scan(locationId: string, orderId: string, dto: DeskScanDto, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const order = await this.ordering.getOrder(orderId);
    if (!order) throw new NotFoundException('Order not found');
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId } });
    if (shipment && shipment.locationId !== locationId) throw new ConflictException('Order shipment is allocated to another fulfillment location');

    // A retried request for the same physical scan returns the original outcome.
    const prior = await this.prisma.fulfillmentReceipt.findUnique({ where: { idempotencyKey: dto.clientScanId } });
    if (prior) {
      if (prior.orderId !== orderId || prior.actorId !== actor.id) throw new ConflictException('This scan id was already used for another receipt');
      return this.outcome('received', orderId, locationId, actor, { skuId: prior.skuId });
    }

    if (!OPEN_ORDER_STATUSES.includes(order.status)) return this.reject(shipment?.id, 'ORDER_NOT_OPEN', dto, actor, orderId, locationId);
    const unit = await this.fulfillment.resolveUnitIdentity({
      barcodeScanned: dto.barcodeScanned, skuId: dto.barcodeScanned ? undefined : dto.skuId,
      manualReason: dto.manualReason, manualChecks: dto.manualChecks,
    });
    if (!unit.ok) return this.reject(shipment?.id, unit.code, dto, actor, orderId, locationId);
    const items = order.items.filter(item => item.skuId === unit.skuId);
    if (!items.length) return this.reject(shipment?.id, 'WRONG_ITEM', dto, actor, orderId, locationId, unit.skuId);

    if (shipment && shipment.status !== ShipmentStatus.pending) {
      if (shipment.status === ShipmentStatus.ready_to_prepare || shipment.status === ShipmentStatus.preparing) {
        // Everything is already in: the receipt scans verify the order; this extra scan is a duplicate.
        await this.fulfillment.verifyPreparationFromReceipts(shipment.id, actor);
        return this.reject(shipment.id, 'ALREADY_COMPLETE', dto, actor, orderId, locationId, unit.skuId);
      }
      return this.reject(shipment.id, 'PACKING_STARTED', dto, actor, orderId, locationId, unit.skuId);
    }

    const receivables = (await this.fulfillment.getReceivables(locationId, actor))
      .filter(r => r.orderId === orderId && r.skuId === unit.skuId && r.remainingQuantity > 0);
    const target = receivables.find(r => items.some(item => item.id === r.orderItemId));
    if (!target) {
      const received = await this.prisma.fulfillmentReceipt.aggregate({ where: { orderId, skuId: unit.skuId }, _sum: { quantity: true } });
      const required = items.reduce((sum, item) => sum + item.quantity, 0);
      return this.reject(shipment?.id, (received._sum.quantity ?? 0) >= required ? 'ALREADY_COMPLETE' : 'NOT_PURCHASED_YET', dto, actor, orderId, locationId, unit.skuId);
    }
    if (!dto.expiryDate) {
      throw new BadRequestException({ code: 'EXPIRY_REQUIRED', skuId: unit.skuId, message: 'Enter the expiry date printed on the pack before scanning it in' });
    }
    const sku = await this.catalog.getSkuIdentity(unit.skuId);
    if (!sku) throw new NotFoundException('SKU not found');
    const receipt = await this.fulfillment.receiveAllocatedGoods({
      locationId, allocationId: target.allocationId, orderId, orderItemId: target.orderItemId, skuId: unit.skuId,
      variantName: sku.variantName, quantity: 1, condition: 'ACCEPTABLE', idempotencyKey: dto.clientScanId,
      ...(dto.barcodeScanned ? { barcodeScanned: dto.barcodeScanned } : { manualReason: dto.manualReason, manualChecks: dto.manualChecks }),
      ...(dto.lotNumber ? { lotNumber: dto.lotNumber } : {}), expiryDate: dto.expiryDate,
    }, actor);
    if (receipt.shipment?.status === ShipmentStatus.ready_to_prepare) {
      await this.fulfillment.verifyPreparationFromReceipts(receipt.shipment.id, actor);
    }
    return this.outcome('received', orderId, locationId, actor, { skuId: unit.skuId });
  }

  /** Verification for orders received before the desk existed (or interrupted): receipt scans count once. */
  async verify(locationId: string, orderId: string, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId } });
    if (!shipment || shipment.locationId !== locationId) throw new NotFoundException('No shipment for this order at this Hub');
    if (shipment.status === ShipmentStatus.pending) {
      throw new ConflictException({ code: 'GOODS_NOT_RECEIVED', message: 'Not every item of this order has been scanned in yet' });
    }
    await this.fulfillment.verifyPreparationFromReceipts(shipment.id, actor);
    return this.outcome('verified', orderId, locationId, actor, {});
  }

  private stageOf(status: ShipmentStatus | null, lines: DeskLine[]): DeskStage {
    if (status === ShipmentStatus.ready_to_prepare || status === ShipmentStatus.preparing) return 'verifying';
    if (status && status !== ShipmentStatus.pending) return 'packing';
    return lines.some(line => line.purchased > line.received) ? 'receiving' : 'waiting_purchase';
  }

  private async outcome(kind: DeskScanOutcome, orderId: string, locationId: string, actor: FulfillmentActor, extra: { skuId?: string; code?: DeskRejectCode }) {
    const desk = await this.getDesk(locationId, actor);
    return { outcome: kind, ...extra, order: desk.orders.find(o => o.orderId === orderId) ?? null };
  }

  private async reject(shipmentId: string | undefined, code: DeskRejectCode, dto: DeskScanDto, actor: FulfillmentActor, orderId: string, locationId: string, skuId?: string) {
    if (shipmentId) {
      await this.prisma.shipmentEvent.create({ data: {
        shipmentId, type: 'DESK_SCAN_REJECTED', actorId: actor.id, reasonCode: code,
        notes: `${dto.barcodeScanned ? `barcode ${dto.barcodeScanned}` : 'manual check'}${skuId ? ` → sku ${skuId}` : ''} (scan ${dto.clientScanId})`,
      } });
    }
    return this.outcome('rejected', orderId, locationId, actor, { code, ...(skuId ? { skuId } : {}) });
  }

  /** Lot/expiry last recorded at this Hub for each SKU, offered for confirmation (never applied silently). */
  private async lastLots(locationId: string, skuIds: string[]) {
    if (!skuIds.length) return {};
    const rows = await this.prisma.fulfillmentReceipt.findMany({
      where: { locationId, skuId: { in: [...new Set(skuIds)] }, expiryDate: { not: null } },
      orderBy: { receivedAt: 'desc' }, distinct: ['skuId'], select: { skuId: true, lotNumber: true, expiryDate: true, receivedAt: true },
    });
    return Object.fromEntries(rows.map(row => [row.skuId, {
      lotNumber: row.lotNumber, expiryDate: row.expiryDate!.toISOString().slice(0, 10), recordedAt: row.receivedAt,
    }]));
  }
}
