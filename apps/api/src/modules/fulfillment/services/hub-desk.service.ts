import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService } from '../../ordering/public';
import { CatalogService, ProductIdentityService } from '../../catalog/public';
import { PurchaseCostService } from '../../sourcing/public';
import { DeskScanDto, RegisterBarcodeDto, ReverseReceiptDto } from '../dto/hub-desk.dto';
import { MANUAL_IDENTITY_CHECKS } from '../dto/fulfillment.dto';
import { FulfillmentActor, FulfillmentService } from './fulfillment.service';
import { derivePrintState, PrintState } from './print-state';
import { isValidGtin } from './barcode-format';

/** Shipments the one-person desk still works on: receiving, verification, packaging and printing. */
const DESK_SHIPMENT_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.pending, ShipmentStatus.ready_to_prepare, ShipmentStatus.preparing,
  ShipmentStatus.prepared, ShipmentStatus.ready_to_pack, ShipmentStatus.packing,
];
const OPEN_ORDER_STATUSES = ['placed', 'confirmed', 'packing'];
const PRINT_EVENTS = ['LABEL_GENERATED', 'LABEL_PRINTED', 'RECEIPT_PRINTED', 'PRINT_FAILED'];
// A received unit can still be corrected until the parcel is printed or packed (mirrors FulfillmentService.reverseReceipt).
const CORRECTABLE: ShipmentStatus[] = [ShipmentStatus.pending, ShipmentStatus.ready_to_prepare, ShipmentStatus.preparing, ShipmentStatus.prepared];

export type DeskStage = 'waiting_purchase' | 'receiving' | 'verifying' | 'packing';
export type DeskScanOutcome = 'received' | 'verified' | 'rejected';
export type DeskRejectCode =
  | 'PRODUCT_IDENTITY_REVIEW_REQUIRED' | 'PRODUCT_IDENTITY_AMBIGUOUS' | 'WRONG_ITEM'
  | 'ALREADY_COMPLETE' | 'NOT_PURCHASED_YET' | 'ORDER_NOT_OPEN' | 'PACKING_STARTED';

export interface DeskLine {
  orderItemId: string; skuId: string; productName: string | null; brandName: string | null; variantName: string | null
  skuCode: string | null; barcode: string | null; imageUrl: string | null
  /** Pack size as printed, e.g. "200 ml" (null when the catalog has none). */
  size: string | null
  /** Units the customer ordered. */
  required: number
  /** Units recorded as bought on the Purchases checklist (received + still awaiting the scan). Not a physical fact. */
  purchased: number
  /** Units physically scanned in at the Hub against this order line. */
  received: number
  /** Units counted by the preparation verification. */
  verified: number
  /** Actual purchase cost of the purchase the next unit belongs to: recorded already, or still to be captured at this receipt. */
  cost: { acquireKey: string; recorded: boolean; listUnitPrice: string | null; discountPerUnit: string | null; finalUnitCost: string | null } | null
}

/** One physically received unit (a committed scan) that can still be corrected with a compensating event. */
export interface DeskUnit {
  receiptId: string; skuId: string; quantity: number; lotNumber: string | null; expiryDate: string | null; receivedAt: Date; correctable: boolean
}

export interface DeskCorrection { receiptId: string; reversesReceiptId: string; skuId: string; reason: string | null; note: string | null; at: Date; actorId: string }

export interface DeskOrder {
  orderId: string; orderNumber: string; orderStatus: string; placedAt: Date; governorate: string | null; area: string | null
  shipment: { id: string; status: ShipmentStatus } | null
  stage: DeskStage
  lines: DeskLine[]
  printEvents: string[]
  /** Which paper is currently confirmed printed, which failed (and why), derived from the operator's confirmations. */
  print: PrintState
  /** Units currently counted as received (corrected ones are gone from here and listed in `corrections`). */
  units: DeskUnit[]
  corrections: DeskCorrection[]
  /** Scans refused for this order (they changed nothing). */
  rejectedScans: number
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
    private readonly purchaseCosts: PurchaseCostService,
    private readonly identity: ProductIdentityService,
  ) {}

  async getDesk(locationId: string, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const [receivables, shipments] = await Promise.all([
      this.fulfillment.getReceivables(locationId, actor),
      this.prisma.shipment.findMany({
        where: { locationId, status: { in: DESK_SHIPMENT_STATUSES } },
        include: {
          items: true,
          preparationSessions: { where: { status: { not: 'failed' } }, orderBy: { startedAt: 'desc' }, take: 1, include: { scanEvents: { where: { isSuccessful: true }, select: { skuId: true } } } },
          events: { where: { type: { in: PRINT_EVENTS } }, select: { type: true, reasonCode: true, notes: true, createdAt: true } },
        },
      }),
    ]);
    const orderIds = [...new Set([...receivables.map(r => r.orderId), ...shipments.map(s => s.orderId)])];
    const [orders, receipts, receiptRows, attempts] = await Promise.all([
      Promise.all(orderIds.map(id => this.ordering.getOrder(id))),
      this.prisma.fulfillmentReceipt.groupBy({ by: ['orderItemId'], where: { orderId: { in: orderIds } }, _sum: { quantity: true } }),
      this.prisma.fulfillmentReceipt.findMany({ where: { orderId: { in: orderIds } }, orderBy: { receivedAt: 'asc' } }),
      this.prisma.hubScanAttempt.groupBy({ by: ['orderId'], where: { orderId: { in: orderIds } }, _count: { _all: true } }),
    ]);
    const costs = await this.purchaseCosts.recordedByKeys(receivables.map(r => (r as { acquireKey?: string }).acquireKey).filter((k): k is string => !!k));
    const receivedByItem = new Map(receipts.map(row => [row.orderItemId, row._sum.quantity ?? 0]));
    const awaitingByItem = new Map<string, number>();
    for (const r of receivables) awaitingByItem.set(r.orderItemId, (awaitingByItem.get(r.orderItemId) ?? 0) + r.remainingQuantity);
    // The purchase the next unit of each line belongs to (oldest first, as the receive command picks it).
    const nextPurchase = new Map<string, string>();
    for (const r of receivables) { const key = (r as { acquireKey?: string }).acquireKey; if (key && !nextPurchase.has(r.orderItemId)) nextPurchase.set(r.orderItemId, key) }
    const attemptsByOrder = new Map(attempts.map(row => [row.orderId, row._count._all]));
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
          size: label?.size != null ? `${label.size}${label.sizeUnit ? ` ${label.sizeUnit}` : ""}` : null,
          required: item.quantity, purchased: received + (awaitingByItem.get(item.id) ?? 0), received,
          verified: Math.min(scans.filter(scan => scan.skuId === item.skuId).length, item.quantity),
          cost: (() => {
            const key = nextPurchase.get(item.id);
            if (!key) return null;
            const recorded = costs.get(key);
            return { acquireKey: key, recorded: !!recorded, listUnitPrice: recorded?.listUnitPrice ?? null, discountPerUnit: recorded?.discountPerUnit ?? null, finalUnitCost: recorded?.finalUnitCost ?? null };
          })(),
        };
      });
      const rows = receiptRows.filter(row => row.orderId === order.id);
      const reversedIds = new Set(rows.map(row => row.reversesReceiptId).filter((id): id is string => !!id));
      const printed = shipment?.events.some(event => ['LABEL_PRINTED', 'RECEIPT_PRINTED'].includes(event.type)) ?? false;
      const correctable = (!shipment || CORRECTABLE.includes(shipment.status)) && !printed;
      return {
        orderId: order.id, orderNumber: order.orderNumber, orderStatus: order.status, placedAt: order.createdAt,
        governorate: order.governorate ?? null, area: order.area ?? null,
        shipment: shipment ? { id: shipment.id, status: shipment.status } : null,
        stage: this.stageOf(shipment?.status ?? null, lines),
        lines,
        printEvents: [...new Set(shipment?.events.map(e => e.type) ?? [])],
        print: derivePrintState(shipment?.events ?? []),
        units: rows.filter(row => !row.reversesReceiptId && !reversedIds.has(row.id)).map(row => ({
          receiptId: row.id, skuId: row.skuId, quantity: row.quantity, lotNumber: row.lotNumber,
          expiryDate: row.expiryDate ? row.expiryDate.toISOString().slice(0, 10) : null, receivedAt: row.receivedAt, correctable,
        })),
        corrections: rows.filter(row => row.reversesReceiptId).map(row => ({
          receiptId: row.id, reversesReceiptId: row.reversesReceiptId!, skuId: row.skuId, reason: row.correctionReason, note: row.correctionNote, at: row.receivedAt, actorId: row.actorId,
        })),
        rejectedScans: attemptsByOrder.get(order.id) ?? 0,
      };
    });
    const order: Record<DeskStage, number> = { receiving: 0, verifying: 1, packing: 2, waiting_purchase: 3 };
    result.sort((a, b) => order[a.stage] - order[b.stage] || +new Date(a.placedAt) - +new Date(b.placedAt));
    const skuIds = open.flatMap(o => o.items.map(i => i.skuId));
    return { orders: result, lastLots: await this.lastLots(locationId, skuIds), lastCosts: Object.fromEntries(await this.purchaseCosts.lastCostBySku(skuIds)) };
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
    // A cost already recorded for this purchase must match what is entered now; a different value is a correction, never a silent overwrite.
    const acquireKey = (target as { acquireKey?: string }).acquireKey;
    if (dto.cost && acquireKey) {
      PurchaseCostService.finalUnitCost(dto.cost);
      const recorded = (await this.purchaseCosts.recordedByKeys([acquireKey])).get(acquireKey);
      if (recorded && (Number(recorded.listUnitPrice) !== dto.cost.listUnitPrice || Number(recorded.discountPerUnit) !== (dto.cost.discountPerUnit ?? 0))) {
        throw new ConflictException({ code: 'COST_MISMATCH', message: 'This purchase already has a different recorded cost; correct that cost with a reason instead', recorded });
      }
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
    if (dto.cost && acquireKey) {
      // After the unit is in: a replay of the same values is a no-op; the first value for this purchase is stored once.
      await this.purchaseCosts.record({ acquireKey, listUnitPrice: dto.cost.listUnitPrice, discountPerUnit: dto.cost.discountPerUnit }, actor.id)
        .catch(error => { if ((error as { response?: { code?: string } })?.response?.code !== 'COST_ALREADY_RECORDED') throw error; });
    }
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

  /**
   * Registers the barcode a product is missing, from the desk, after the operator verified the exact unit against an order line.
   * Allowed only for a SKU that has no usable code yet (no primary barcode and no approved alias) and only for a code that identifies nothing
   * else, so it can never take over another product's code or silently replace one. The code becomes an approved alias of that SKU with the
   * actor, order and reason kept as evidence; every outcome (registered or refused) is recorded against the order. Idempotent on clientScanId.
   */
  async registerBarcode(locationId: string, orderId: string, dto: RegisterBarcodeDto, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const order = await this.ordering.getOrder(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new ConflictException({ code: 'ORDER_NOT_OPEN', message: 'This order is cancelled or closed' });
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId } });
    if (shipment && shipment.locationId !== locationId) throw new ConflictException('Order shipment is allocated to another fulfillment location');

    const prior = await this.prisma.hubScanAttempt.findUnique({ where: { orderId_clientScanId: { orderId, clientScanId: dto.clientScanId } } });
    if (prior) {
      if (prior.actorId !== actor.id || prior.outcomeCode !== 'BARCODE_REGISTERED') throw new ConflictException({ code: 'REGISTRATION_ALREADY_ATTEMPTED', message: 'This registration id was already used' });
      return { registered: true as const, replayed: true, skuId: prior.skuId, barcode: prior.barcodeScanned, ...(await this.view(orderId, locationId, actor)) };
    }

    const barcode = dto.barcode.trim();
    const refuse = async (code: string, message: string, extra: Record<string, unknown> = {}): Promise<never> => {
      await this.prisma.hubScanAttempt.create({ data: {
        locationId, context: 'desk', orderId, clientScanId: dto.clientScanId, barcodeScanned: barcode.slice(0, 64), skuId: dto.skuId,
        outcomeCode: `REGISTER_${code}`.slice(0, 60), actorId: actor.id,
      } }).catch(error => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error; });
      throw new ConflictException({ code, message, ...extra });
    };

    if (new Set(dto.checks).size !== MANUAL_IDENTITY_CHECKS.length || !MANUAL_IDENTITY_CHECKS.every(check => dto.checks.includes(check))) {
      throw new BadRequestException({ code: 'CHECKS_INCOMPLETE', message: 'Verify the brand, variant, size and pack of the physical product before registering its barcode' });
    }
    if (!isValidGtin(barcode)) return refuse('INVALID_BARCODE', 'This is not a valid retail barcode (check the digits or scan it again)');
    const item = order.items.find(line => line.skuId === dto.skuId);
    if (!item) return refuse('WRONG_ITEM', 'This product is not part of this order');
    const sku = await this.catalog.getSkuIdentity(dto.skuId);
    if (!sku) throw new NotFoundException('SKU not found');
    if (sku.barcode) return refuse('SKU_ALREADY_HAS_BARCODE', 'This product already has a registered barcode; a different code goes through catalog review', { registered: sku.barcode });
    if ((await this.identity.listAliases(dto.skuId)).some(alias => alias.status === 'approved')) {
      return refuse('SKU_ALREADY_HAS_BARCODE', 'This product already has an approved barcode; a different code goes through catalog review');
    }
    const resolved = await this.identity.resolveBarcode(barcode);
    if (resolved.status !== 'unknown') return refuse('BARCODE_ALREADY_USED', 'This code already identifies a product in the catalog; it cannot be registered again', { sameProduct: resolved.status === 'resolved' && resolved.skuId === dto.skuId });

    try {
      await this.identity.approveAlias({ barcode, skuId: dto.skuId, source: 'hub_registration', evidenceRef: `hub-desk:${orderId}`.slice(0, 255),
        reason: `${dto.note.trim()} (verified ${dto.checks.join(', ')} on order ${order.orderNumber})`.slice(0, 500), actorId: actor.id });
    } catch (error) {
      if (error instanceof ConflictException) return refuse('BARCODE_ALREADY_USED', 'This code already identifies another product; resolve it in catalog review first');
      throw error;
    }
    await this.prisma.hubScanAttempt.create({ data: {
      locationId, context: 'desk', orderId, clientScanId: dto.clientScanId, barcodeScanned: barcode, skuId: dto.skuId, outcomeCode: 'BARCODE_REGISTERED', actorId: actor.id,
    } }).catch(error => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error; });
    return { registered: true as const, replayed: false, skuId: dto.skuId, barcode, ...(await this.view(orderId, locationId, actor)) };
  }

  private async view(orderId: string, locationId: string, actor: FulfillmentActor) {
    const desk = await this.getDesk(locationId, actor);
    return { order: desk.orders.find(o => o.orderId === orderId) ?? null };
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

  /** An order-level record of a refused scan (exists before any shipment does); receipt quantities are never touched. */
  private async reject(_shipmentId: string | undefined, code: DeskRejectCode, dto: DeskScanDto, actor: FulfillmentActor, orderId: string, locationId: string, skuId?: string) {
    await this.prisma.hubScanAttempt.create({ data: {
      locationId, context: 'desk', orderId, clientScanId: dto.clientScanId, barcodeScanned: dto.barcodeScanned ?? null,
      skuId: skuId ?? null, outcomeCode: code, actorId: actor.id,
    } }).catch(error => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error; });
    return this.outcome('rejected', orderId, locationId, actor, { code, ...(skuId ? { skuId } : {}) });
  }

  /** Corrects one received unit with a compensating event (the original stays in the audit trail). */
  async reverse(locationId: string, receiptId: string, dto: ReverseReceiptDto, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const receipt = await this.prisma.fulfillmentReceipt.findUnique({ where: { id: receiptId }, select: { locationId: true, orderId: true } });
    if (!receipt || receipt.locationId !== locationId) throw new NotFoundException('Receipt not found at this Hub');
    const result = await this.fulfillment.reverseReceipt(receiptId, dto, actor);
    return { ...result, ...(await this.outcome('verified', receipt.orderId, locationId, actor, {})) };
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
