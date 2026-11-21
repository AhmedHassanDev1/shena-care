import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { OrderingService, OrderQuantityAdjustmentService } from '../../ordering/public';
import type { QuantityAdjustmentView } from '../../ordering/public';
import { CatalogService, ProductIdentityService } from '../../catalog/public';
import { BatchCostView, PurchaseCostService } from '../../sourcing/public';
import { CorrectBarcodeDto, DecideShortageDto, DeskScanDto, RegisterBarcodeDto, ReportShortageDto, ReverseReceiptDto, SetLineDiscountDto } from '../dto/hub-desk.dto';
import { MANUAL_IDENTITY_CHECKS } from '../dto/fulfillment.dto';
import { FulfillmentActor, FulfillmentService } from './fulfillment.service';
import { derivePrintState, PrintState } from './print-state';
import { isValidGtin } from './barcode-format';

type LinePurchase = { acquireKey: string; units: number; cost: BatchCostView | null };
/** The purchase the next unit belongs to, else the line's latest purchase; its recorded cost (if any) with the discount as a percentage. */
function lineCost(list: LinePurchase[], nextKey: string | undefined): DeskLineCost | null {
  const purchase = (nextKey ? list.find(entry => entry.acquireKey === nextKey) : undefined) ?? list[list.length - 1];
  if (!purchase) return null;
  const cost = purchase.cost;
  return {
    acquireKey: purchase.acquireKey, recorded: !!cost, units: purchase.units, version: cost?.version ?? null,
    listUnitPrice: cost?.listUnitPrice ?? null, discountPerUnit: cost?.discountPerUnit ?? null,
    discountPercent: cost ? discountPercentOf(cost.listUnitPrice, cost.discountPerUnit) : null, finalUnitCost: cost?.finalUnitCost ?? null,
  };
}

/** Shipments the one-person desk still works on: receiving, verification, packaging and printing. */
const DESK_SHIPMENT_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.pending, ShipmentStatus.ready_to_prepare, ShipmentStatus.preparing,
  ShipmentStatus.prepared, ShipmentStatus.ready_to_pack, ShipmentStatus.packing,
];
const OPEN_ORDER_STATUSES = ['placed', 'confirmed', 'packing'];
const PRINT_EVENTS = ['LABEL_GENERATED', 'LABEL_PRINTED', 'RECEIPT_PRINTED', 'PRINT_FAILED'];
// A received unit can still be corrected until the parcel is printed or packed (mirrors FulfillmentService.reverseReceipt).
const CORRECTABLE: ShipmentStatus[] = [ShipmentStatus.pending, ShipmentStatus.ready_to_prepare, ShipmentStatus.preparing, ShipmentStatus.prepared];

export type DeskStage = 'waiting_purchase' | 'receiving' | 'shortage_review' | 'verifying' | 'packing';
export type DeskScanOutcome = 'received' | 'verified' | 'identified' | 'rejected';
export type DeskRejectCode =
  | 'PRODUCT_IDENTITY_REVIEW_REQUIRED' | 'PRODUCT_IDENTITY_AMBIGUOUS' | 'WRONG_ITEM'
  | 'ALREADY_COMPLETE' | 'NOT_PURCHASED_YET' | 'ORDER_NOT_OPEN' | 'PACKING_STARTED';

export interface DeskLine {
  orderItemId: string; skuId: string; productName: string | null; brandName: string | null; variantName: string | null
  skuCode: string | null; barcode: string | null; imageUrl: string | null
  /** Pack size as printed, e.g. "200 ml" (null when the catalog has none). */
  size: string | null
  sizeUnit: string | null
  unitPrice: number | null
  texture: string | null
  categoryName: string | null
  productSlug: string | null
  /** Units the order line asks for now (after an approved shortage adjustment this is the reduced quantity). */
  required: number
  /** Units the customer originally ordered (differs from required only after an approved shortage adjustment). */
  ordered: number
  /** An open shortage report waiting for an Admin: the units reported missing and what the line would become. Nothing about the order changed yet. */
  shortage: { adjustmentId: string; missing: number; newQuantity: number; reason: string | null; amounts: QuantityAdjustmentView['amounts']; reportedBy: string } | null
  /** Units recorded as bought on the Purchases checklist (received + still awaiting the scan). Not a physical fact. */
  purchased: number
  /** Units physically scanned in at the Hub against this order line. */
  received: number
  /** Units counted by the preparation verification. */
  verified: number
  /**
   * Actual purchase cost of the line's purchase (the one the next unit belongs to, else the latest): `listUnitPrice` is the supplier's quoted
   * price, `discountPerUnit` the EGP obtained off it and `discountPercent` the same discount as a share of the list price. Null until bought.
   */
  cost: DeskLineCost | null
}

export interface DeskLineCost {
  acquireKey: string; recorded: boolean; units: number; version: number | null
  listUnitPrice: string | null; discountPerUnit: string | null; discountPercent: string | null; finalUnitCost: string | null
}

/** Discount as a share of the list price, to two decimals, e.g. "12.50". */
export const discountPercentOf = (list: Prisma.Decimal.Value, discount: Prisma.Decimal.Value) => {
  const base = new Prisma.Decimal(list);
  return base.lte(0) ? '0.00' : new Prisma.Decimal(discount).div(base).mul(100).toFixed(2);
};

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
    private readonly adjustments: OrderQuantityAdjustmentService,
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
    const purchases = await this.purchaseCosts.purchasesForOrderItems(orders.flatMap(o => (o?.items ?? []).map(i => i.id)));
    const adjustmentList = await this.adjustments.listForOrders(orderIds);
    const openByItem = new Map(adjustmentList.filter(a => a.status === 'proposed').map(a => [a.orderItemId, a]));
    // The original quantity of a line is what it was before its first applied adjustment.
    const originalByItem = new Map<string, number>();
    for (const a of adjustmentList.filter(a => a.status === 'applied')) if (!originalByItem.has(a.orderItemId)) originalByItem.set(a.orderItemId, a.orderedQuantity);
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
          sizeUnit: label?.sizeUnit ?? null,
          unitPrice: item.price ? Number(item.price) : null,
          texture: label?.texture ?? null,
          categoryName: label?.categoryName ?? null,
          productSlug: label?.productSlug ?? null,
          required: item.quantity, ordered: originalByItem.get(item.id) ?? item.quantity,
          shortage: openByItem.has(item.id) ? (() => { const a = openByItem.get(item.id)!; return { adjustmentId: a.id, missing: a.missingQuantity, newQuantity: a.newQuantity, reason: a.reason, amounts: a.amounts, reportedBy: a.proposedBy }; })() : null,
          purchased: received + (awaitingByItem.get(item.id) ?? 0), received,
          verified: Math.min(scans.filter(scan => scan.skuId === item.skuId).length, item.quantity),
          cost: lineCost(purchases.get(item.id) ?? [], nextPurchase.get(item.id)),
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
    const order: Record<DeskStage, number> = { receiving: 0, shortage_review: 1, verifying: 2, packing: 3, waiting_purchase: 4 };
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

    // A retried request for the same confirmation returns the original outcome; a confirmation interrupted half-way continues from what is already in.
    const wanted = dto.quantity ?? 1;
    const priorReceipts = await this.prisma.fulfillmentReceipt.findMany({ where: { idempotencyKey: { startsWith: dto.clientScanId } }, orderBy: { receivedAt: 'asc' } });
    for (const prior of priorReceipts) {
      if (prior.orderId !== orderId || prior.actorId !== actor.id) throw new ConflictException('This scan id was already used for another receipt');
    }
    const alreadyIn = priorReceipts.reduce((sum, prior) => sum + prior.quantity, 0);
    if (priorReceipts.length && alreadyIn >= wanted) return this.outcome('received', orderId, locationId, actor, { skuId: priorReceipts[0].skuId });

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

    const needed = wanted - alreadyIn;
    const receivables = (await this.fulfillment.getReceivables(locationId, actor))
      .filter(r => r.orderId === orderId && r.skuId === unit.skuId && r.remainingQuantity > 0 && items.some(item => item.id === r.orderItemId));
    const available = receivables.reduce((sum, r) => sum + r.remainingQuantity, 0);
    // All or nothing: a confirmation for more units than were bought (or than the order still needs) changes nothing.
    if (!receivables.length || available < needed) {
      const received = await this.prisma.fulfillmentReceipt.aggregate({ where: { orderId, skuId: unit.skuId }, _sum: { quantity: true } });
      const required = items.reduce((sum, item) => sum + item.quantity, 0);
      return this.reject(shipment?.id, (received._sum.quantity ?? 0) >= required ? 'ALREADY_COMPLETE' : 'NOT_PURCHASED_YET', dto, actor, orderId, locationId, unit.skuId);
    }
    const target = receivables[0];
    // A cost already recorded for this purchase must match what is entered now; a different value is a correction, never a silent overwrite.
    const acquireKey = (target as { acquireKey?: string }).acquireKey;
    if (dto.cost && acquireKey) {
      PurchaseCostService.finalUnitCost(dto.cost);
      const recorded = (await this.purchaseCosts.recordedByKeys([acquireKey])).get(acquireKey);
      if (recorded && (Number(recorded.listUnitPrice) !== dto.cost.listUnitPrice || Number(recorded.discountPerUnit) !== (dto.cost.discountPerUnit ?? 0))) {
        throw new ConflictException({ code: 'COST_MISMATCH', message: 'This purchase already has a different recorded cost; correct that cost with a reason instead', recorded });
      }
    }
    // Expiry and lot are not part of the normal preparation flow; a date that is supplied is still checked against the minimum shelf life.
    const sku = await this.catalog.getSkuIdentity(unit.skuId);
    if (!sku) throw new NotFoundException('SKU not found');
    // One identity check, then the units go in purchase by purchase (normally one): each receipt has its own idempotency key derived from the
    // confirmation id, so a retry never double counts and an interrupted confirmation resumes where it stopped.
    let remaining = needed;
    let index = priorReceipts.length;
    let lastShipmentStatus: ShipmentStatus | undefined;
    let lastShipmentId: string | undefined;
    for (const slot of receivables) {
      if (remaining <= 0) break;
      const take = Math.min(slot.remainingQuantity, remaining);
      const receipt = await this.fulfillment.receiveAllocatedGoods({
        locationId, allocationId: slot.allocationId, orderId, orderItemId: slot.orderItemId, skuId: unit.skuId,
        variantName: sku.variantName, quantity: take, condition: 'ACCEPTABLE', idempotencyKey: index === 0 ? dto.clientScanId : `${dto.clientScanId}#${index + 1}`,
        ...(dto.barcodeScanned ? { barcodeScanned: dto.barcodeScanned } : { manualReason: dto.manualReason, manualChecks: dto.manualChecks }),
        ...(dto.lotNumber ? { lotNumber: dto.lotNumber } : {}), ...(dto.expiryDate ? { expiryDate: dto.expiryDate } : {}),
      }, actor);
      remaining -= take;
      index += 1;
      lastShipmentStatus = receipt.shipment?.status;
      lastShipmentId = receipt.shipment?.id;
    }
    if (dto.cost && acquireKey) {
      // After the units are in: a replay of the same values is a no-op; the first value for this purchase is stored once.
      await this.purchaseCosts.record({ acquireKey, listUnitPrice: dto.cost.listUnitPrice, discountPerUnit: dto.cost.discountPerUnit }, actor.id)
        .catch(error => { if ((error as { response?: { code?: string } })?.response?.code !== 'COST_ALREADY_RECORDED') throw error; });
    }
    if (lastShipmentId && lastShipmentStatus === ShipmentStatus.ready_to_prepare) {
      await this.fulfillment.verifyPreparationFromReceipts(lastShipmentId, actor);
    }
    return this.outcome('received', orderId, locationId, actor, { skuId: unit.skuId });
  }

  /**
   * Identity check only (scan once per product): the barcode or the manual check is resolved against the order's lines exactly as a scan is,
   * but nothing is received. The confirmation that follows carries the same evidence and the quantity, and is checked again by the server.
   */
  async identify(locationId: string, orderId: string, dto: DeskScanDto, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const order = await this.ordering.getOrder(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (!OPEN_ORDER_STATUSES.includes(order.status)) return this.reject(undefined, 'ORDER_NOT_OPEN', dto, actor, orderId, locationId);
    const unit = await this.fulfillment.resolveUnitIdentity({
      barcodeScanned: dto.barcodeScanned, skuId: dto.barcodeScanned ? undefined : dto.skuId,
      manualReason: dto.manualReason, manualChecks: dto.manualChecks,
    });
    if (!unit.ok) return this.reject(undefined, unit.code, dto, actor, orderId, locationId);
    if (!order.items.some(item => item.skuId === unit.skuId)) return this.reject(undefined, 'WRONG_ITEM', dto, actor, orderId, locationId, unit.skuId);
    return this.outcome('identified', orderId, locationId, actor, { skuId: unit.skuId });
  }

  /** Units physically received for one order line (corrections already netted out). */
  private async receivedFor(orderItemId: string) {
    const sum = await this.prisma.fulfillmentReceipt.aggregate({ where: { orderItemId }, _sum: { quantity: true } });
    return sum._sum.quantity ?? 0;
  }

  /**
   * The Hub reports that some units of a line do not exist (fewer than ordered are available). This only records a proposal: the order, its
   * totals and the COD stay as they are, the line is flagged for an Admin and the order cannot move on until that decision is made. Missing
   * units are never counted as received or verified.
   */
  async reportShortage(locationId: string, orderId: string, orderItemId: string, dto: ReportShortageDto, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const order = await this.ordering.getOrder(orderId);
    if (!order) throw new NotFoundException('Order not found');
    const item = order.items.find(line => line.id === orderItemId);
    if (!item) throw new NotFoundException('Order line not found');
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId } });
    if (shipment && shipment.locationId !== locationId) throw new ConflictException('Order shipment is allocated to another fulfillment location');
    if (shipment && shipment.status !== ShipmentStatus.pending && shipment.status !== ShipmentStatus.ready_to_prepare) {
      throw new ConflictException({ code: 'PREPARATION_ALREADY_VERIFIED', message: 'This order is already verified; a shortage can only be reported before verification' });
    }
    // The available units cannot be fewer than what was already counted in.
    const received = await this.receivedFor(orderItemId);
    if (received > item.quantity - dto.missingQuantity) {
      throw new ConflictException({ code: 'RECEIVED_EXCEEDS_AVAILABLE', message: 'More units were already received than the available quantity you entered; correct the received units first' });
    }
    await this.adjustments.propose({ orderId, orderItemId, missingQuantity: dto.missingQuantity, reason: dto.reason, locationId, clientRequestId: dto.clientRequestId, actorId: actor.id });
    return this.outcome('verified', orderId, locationId, actor, {});
  }

  /** An Admin applies a shortage report: line quantity, order totals, COD and the sourcing requirement follow, then the parcel can complete. */
  async approveShortage(locationId: string, orderId: string, adjustmentId: string, dto: DecideShortageDto, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const adj = await this.adjustments.get(adjustmentId);
    if (adj.orderId !== orderId || (adj.locationId && adj.locationId !== locationId)) throw new NotFoundException('Shortage report not found for this order at this Hub');
    await this.adjustments.approve(adjustmentId, actor.id, dto.note, await this.receivedFor(adj.orderItemId));
    // The order is already adjusted; this step is idempotent and completes the receiving that the reduced quantity now satisfies.
    await this.fulfillment.reconcileAfterQuantityAdjustment(orderId, actor);
    return this.outcome('verified', orderId, locationId, actor, {});
  }

  async rejectShortage(locationId: string, orderId: string, adjustmentId: string, dto: DecideShortageDto, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const adj = await this.adjustments.get(adjustmentId);
    if (adj.orderId !== orderId || (adj.locationId && adj.locationId !== locationId)) throw new NotFoundException('Shortage report not found for this order at this Hub');
    await this.adjustments.reject(adjustmentId, actor.id, dto.note);
    return this.outcome('verified', orderId, locationId, actor, {});
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

  /**
   * Corrects the barcode of a product that already has one (catalog reviewers only: the route requires catalog.manage). Same evidence as a
   * registration (the four identity checks and a note, against an order line) plus the same refusals; the replaced code stays on record as a
   * retired alias with the actor and reason (ProductIdentityService.replacePrimaryBarcode), and every outcome is logged against the order.
   */
  async correctBarcode(locationId: string, orderId: string, dto: CorrectBarcodeDto, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const order = await this.ordering.getOrder(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new ConflictException({ code: 'ORDER_NOT_OPEN', message: 'This order is cancelled or closed' });
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId } });
    if (shipment && shipment.locationId !== locationId) throw new ConflictException('Order shipment is allocated to another fulfillment location');

    const prior = await this.prisma.hubScanAttempt.findUnique({ where: { orderId_clientScanId: { orderId, clientScanId: dto.clientScanId } } });
    if (prior) {
      if (prior.actorId !== actor.id || prior.outcomeCode !== 'BARCODE_CORRECTED') throw new ConflictException({ code: 'CORRECTION_ALREADY_ATTEMPTED', message: 'This correction id was already used' });
      return { corrected: true as const, replayed: true, skuId: prior.skuId, barcode: prior.barcodeScanned, ...(await this.view(orderId, locationId, actor)) };
    }
    const barcode = dto.barcode.trim();
    const refuse = async (code: string, message: string, extra: Record<string, unknown> = {}): Promise<never> => {
      await this.prisma.hubScanAttempt.create({ data: {
        locationId, context: 'desk', orderId, clientScanId: dto.clientScanId, barcodeScanned: barcode.slice(0, 64), skuId: dto.skuId,
        outcomeCode: `CORRECT_${code}`.slice(0, 60), actorId: actor.id,
      } }).catch(error => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error; });
      throw new ConflictException({ code, message, ...extra });
    };
    if (new Set(dto.checks).size !== MANUAL_IDENTITY_CHECKS.length || !MANUAL_IDENTITY_CHECKS.every(check => dto.checks.includes(check))) {
      throw new BadRequestException({ code: 'CHECKS_INCOMPLETE', message: 'Verify the brand, variant, size and pack of the physical product before correcting its barcode' });
    }
    if (!isValidGtin(barcode)) return refuse('INVALID_BARCODE', 'This is not a valid retail barcode (check the digits or scan it again)');
    if (!order.items.some(line => line.skuId === dto.skuId)) return refuse('WRONG_ITEM', 'This product is not part of this order');
    const sku = await this.catalog.getSkuIdentity(dto.skuId);
    if (!sku) throw new NotFoundException('SKU not found');
    if (!sku.barcode) return refuse('SKU_HAS_NO_BARCODE', 'This product has no barcode yet; register one instead');
    const resolved = await this.identity.resolveBarcode(barcode);
    if (resolved.status !== 'unknown' && !(resolved.status === 'resolved' && resolved.skuId === dto.skuId)) {
      return refuse('BARCODE_ALREADY_USED', 'This code already identifies another product in the catalog; it cannot be used here');
    }
    try {
      await this.identity.replacePrimaryBarcode({ skuId: dto.skuId, barcode, evidenceRef: `hub-desk:${orderId}`.slice(0, 255),
        reason: `${dto.note.trim()} (verified ${dto.checks.join(', ')} on order ${order.orderNumber}; replaced ${sku.barcode})`.slice(0, 500), actorId: actor.id });
    } catch (error) {
      if (error instanceof ConflictException) return refuse('BARCODE_ALREADY_USED', 'This code already identifies another product; resolve it in catalog review first');
      throw error;
    }
    await this.prisma.hubScanAttempt.create({ data: {
      locationId, context: 'desk', orderId, clientScanId: dto.clientScanId, barcodeScanned: barcode, skuId: dto.skuId, outcomeCode: 'BARCODE_CORRECTED', actorId: actor.id,
    } }).catch(error => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error; });
    return { corrected: true as const, replayed: false, skuId: dto.skuId, barcode, ...(await this.view(orderId, locationId, actor)) };
  }

  /**
   * Sets the supplier discount (a percentage of the supplier's list price) on the purchase behind one order line. The base price is the list
   * price recorded for that purchase (or, while none is recorded, the one the operator enters); the stored discount is the EGP amount per
   * unit, so profitability keeps using the same figures. A recorded cost is corrected through the owner's correction (history kept); the
   * customer's confirmed prices are never touched. The order is re-checked for a loss afterwards.
   */
  async setLineDiscount(locationId: string, orderId: string, orderItemId: string, dto: SetLineDiscountDto, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const order = await this.ordering.getOrder(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new ConflictException({ code: 'ORDER_NOT_OPEN', message: 'This order is cancelled or closed' });
    if (!order.items.some(item => item.id === orderItemId)) throw new NotFoundException('Order line not found');
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId } });
    if (shipment && (shipment.locationId !== locationId || !DESK_SHIPMENT_STATUSES.includes(shipment.status))) {
      throw new ConflictException({ code: 'PARCEL_LEFT_THE_DESK', message: 'This parcel is no longer being prepared at this Hub' });
    }
    const purchases = (await this.purchaseCosts.purchasesForOrderItems([orderItemId])).get(orderItemId) ?? [];
    const nextKey = (await this.fulfillment.getReceivables(locationId, actor))
      .find(r => r.orderItemId === orderItemId && r.remainingQuantity > 0 && (r as { acquireKey?: string }).acquireKey) as { acquireKey?: string } | undefined;
    const purchase = (nextKey?.acquireKey ? purchases.find(entry => entry.acquireKey === nextKey.acquireKey) : undefined) ?? purchases[purchases.length - 1];
    if (!purchase) throw new ConflictException({ code: 'NOT_PURCHASED_YET', message: 'This product has not been recorded as bought yet, so it has no supplier price to discount' });

    const recorded = purchase.cost;
    const typedList = dto.listUnitPrice !== undefined ? new Prisma.Decimal(dto.listUnitPrice) : null;
    if (recorded && typedList && !typedList.equals(recorded.listUnitPrice)) {
      throw new ConflictException({ code: 'LIST_PRICE_RECORDED', message: 'The supplier list price of this purchase is already recorded; correct it with a reason in the costs screen', listUnitPrice: recorded.listUnitPrice });
    }
    // The list price IS the product's price on the order line; there is no separate list-price field to fill in first.
    const lineItem = order.items.find(item => item.id === orderItemId);
    const productPrice = lineItem?.price != null ? new Prisma.Decimal(lineItem.price as Prisma.Decimal.Value) : null;
    const list = recorded ? new Prisma.Decimal(recorded.listUnitPrice) : (typedList ?? productPrice);
    if (!list) throw new BadRequestException({ code: 'LIST_PRICE_REQUIRED', message: 'This product has no price on the order, so the discount cannot be priced' });
    const discountPerUnit = list.mul(dto.discountPercent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const cost = { listUnitPrice: list.toNumber(), discountPerUnit: discountPerUnit.toNumber() };
    PurchaseCostService.finalUnitCost(cost);

    if (!recorded) {
      await this.purchaseCosts.record({ acquireKey: purchase.acquireKey, ...cost }, actor.id);
    } else if (!new Prisma.Decimal(recorded.discountPerUnit).equals(discountPerUnit)) {
      await this.purchaseCosts.correct({
        acquireKey: purchase.acquireKey, ...cost, expectedVersion: recorded.version,
        reason: `Supplier discount ${dto.discountPercent}% entered while preparing order ${order.orderNumber}`,
      }, actor.id);
    }
    await this.fulfillment.notifyCostChanged(orderId);
    return this.view(orderId, locationId, actor);
  }

  private async view(orderId: string, locationId: string, actor: FulfillmentActor) {
    const desk = await this.getDesk(locationId, actor);
    return { order: desk.orders.find(o => o.orderId === orderId) ?? null };
  }

  private stageOf(status: ShipmentStatus | null, lines: DeskLine[]): DeskStage {
    if (status === ShipmentStatus.ready_to_prepare || status === ShipmentStatus.preparing) return 'verifying';
    if (status && status !== ShipmentStatus.pending) return 'packing';
    if (lines.some(line => line.shortage)) return 'shortage_review';
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
