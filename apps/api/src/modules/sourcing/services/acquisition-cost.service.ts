import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AcquisitionCostLot, Prisma } from '@prisma/client';
import { CatalogService, ProductIdentityService } from '../../catalog/public';
import { SupportService } from '../../operations/services/support.service';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CaptureAcquisitionCostDto, CorrectAcquisitionCostDto } from '../dto/acquisition-cost.dto';

type Tx = Prisma.TransactionClient;
type LineWithCost = Prisma.PurchaseOrderLineGetPayload<{ include: { allocations: true; costLots: true } }>;

export type LineCostStatus = 'NOT_RECEIVED' | 'COST_PENDING' | 'COST_CAPTURED' | 'COST_SNAPSHOT';
export interface LineCostSummary {
  received: number;
  costed: number;
  pending: number;
  status: LineCostStatus;
  /** Exact total of captured lots; the payable uses this, never a rounded average. */
  capturedValue: Prisma.Decimal;
}
export interface MarginWarning { orderId: string; orderItemId: string; unitNetPrice: string; unitCost: string; unitContribution: string; supportCaseId: string }

const EGP = 'EGP';
const CLOSED_PAYABLE = 'paid';
/** Marks an adjustment that restates the goods value, so it is never mistaken for a supplier credit. */
export const COST_CORRECTION_REASON_PREFIX = 'COST_CORRECTION:';

/** Quantity this line must pay for: units physically received at the Hub, or the supplier-confirmed quantity on legacy unlinked lines. */
export function acceptedQuantity(line: { confirmedQuantity: number | null; allocations: Array<{ receivedQuantity: number }> }): number {
  return line.allocations.length ? line.allocations.reduce((sum, link) => sum + link.receivedQuantity, 0) : line.confirmedQuantity ?? 0;
}

export function summarizeLineCost(line: { unitCost: Prisma.Decimal | null; confirmedQuantity: number | null; allocations: Array<{ receivedQuantity: number }>; costLots: Array<{ quantity: number; unitCost: Prisma.Decimal }> }): LineCostSummary {
  const received = acceptedQuantity(line);
  const costed = line.costLots.reduce((sum, lot) => sum + lot.quantity, 0);
  const capturedValue = line.costLots.reduce((sum, lot) => sum.plus(lot.unitCost.mul(lot.quantity)), new Prisma.Decimal(0));
  if (!line.costLots.length && line.unitCost !== null) {
    return { received, costed: received, pending: 0, status: received ? 'COST_SNAPSHOT' : 'NOT_RECEIVED', capturedValue: line.unitCost.mul(received) };
  }
  const pending = Math.max(received - costed, 0);
  const status: LineCostStatus = received === 0 ? 'NOT_RECEIVED' : pending > 0 ? 'COST_PENDING' : 'COST_CAPTURED';
  return { received, costed, pending, status, capturedValue };
}

/**
 * Hub actual acquisition cost (GLO-238 / GLO-283 cost seam). Physical receipt and financial completion are separate facts: goods can be received
 * with cost pending, and the supplier payable cannot be created or closed until every received unit has invoice evidence. Nothing here reads a
 * retail price or a SupplierOffer as a cost, and nothing here writes to a customer order.
 */
@Injectable()
export class AcquisitionCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly identity: ProductIdentityService,
    private readonly support: SupportService,
  ) {}

  private static normalizeInvoiceRef(value: string) {
    const normalized = value.trim().replace(/\s+/g, ' ').toUpperCase();
    if (!normalized) throw new BadRequestException('Supplier invoice reference is required');
    return normalized;
  }

  private async lockLine(tx: Tx, lineId: string) {
    await tx.$queryRaw`SELECT id FROM sourcing.purchase_order_lines WHERE id = ${lineId}::uuid FOR UPDATE`;
    const line = await tx.purchaseOrderLine.findUnique({ where: { id: lineId }, include: { allocations: true, costLots: true, purchaseOrder: { select: { id: true, supplierId: true, status: true } } } });
    if (!line) throw new NotFoundException('Purchase order line not found');
    return line;
  }

  private static snapshot(lot: Pick<AcquisitionCostLot, 'invoiceRef' | 'invoiceLineRef' | 'quantity' | 'unitCost' | 'currency' | 'version'>) {
    return { invoiceRef: lot.invoiceRef, invoiceLineRef: lot.invoiceLineRef, quantity: lot.quantity, unitCost: lot.unitCost.toFixed(2), currency: lot.currency, version: lot.version };
  }

  /** Records invoice cost for received units. Retries replay; a second capture of one invoice line is refused, never added. */
  async capture(purchaseOrderId: string, lineId: string, dto: CaptureAcquisitionCostDto, actorId: string) {
    if (dto.currency && dto.currency !== EGP) throw new BadRequestException('Acquisition cost is recorded in EGP');
    const invoiceRef = AcquisitionCostService.normalizeInvoiceRef(dto.invoiceRef);
    const invoiceLineRef = dto.invoiceLineRef?.trim().toUpperCase() ?? '';
    const unitCost = new Prisma.Decimal(dto.unitCost);
    if (unitCost.lte(0) || unitCost.decimalPlaces() > 2) throw new BadRequestException('Unit cost must be a positive EGP amount with at most 2 decimals');

    const matches = (lot: AcquisitionCostLot) => lot.purchaseOrderLineId === lineId && lot.invoiceRef === invoiceRef && lot.invoiceLineRef === invoiceLineRef
      && lot.capturedBy === actorId && lot.quantity === dto.quantity && lot.unitCost.equals(unitCost);
    const prior = await this.prisma.acquisitionCostLot.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (prior) {
      if (!matches(prior)) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This idempotency key was already used for a different cost' });
      return { lot: prior, replayed: true, marginWarnings: [] as MarginWarning[], line: await this.lineSummary(lineId) };
    }

    if (dto.barcodeScanned) await this.assertBarcodeIdentity(lineId, dto.barcodeScanned);

    try {
      return await this.prisma.$transaction(async tx => {
        const line = await this.lockLine(tx, lineId);
        if (line.purchaseOrderId !== purchaseOrderId) throw new NotFoundException('Line does not belong to this purchase order');
        if (dto.expectedSupplierId && dto.expectedSupplierId !== line.purchaseOrder.supplierId) {
          throw new ConflictException({ code: 'SUPPLIER_MISMATCH', message: 'The invoice supplier is not the supplier of this binding purchase order' });
        }
        const summary = summarizeLineCost({ ...line, unitCost: null });
        if (summary.received === 0) throw new ConflictException({ code: 'GOODS_NOT_RECEIVED', message: 'Receive the goods at the Hub before recording their cost' });
        if (summary.costed + dto.quantity > summary.received) {
          throw new ConflictException({ code: 'COST_QUANTITY_EXCEEDS_RECEIVED', message: `Only ${summary.pending} received unit(s) on this line still need a cost` });
        }
        const payable = await tx.supplierPayable.findUnique({ where: { purchaseOrderId: line.purchaseOrderId } });
        if (payable?.status === CLOSED_PAYABLE) throw new ConflictException({ code: 'PAYABLE_CLOSED', message: 'This purchase order is already paid' });
        const duplicate = line.costLots.find(lot => lot.invoiceRef === invoiceRef && lot.invoiceLineRef === invoiceLineRef);
        if (duplicate) throw new ConflictException({ code: 'DUPLICATE_INVOICE_LINE', message: `Invoice ${invoiceRef} is already recorded on this line; correct it instead of recording it again`, lotId: duplicate.id });

        const lot = await tx.acquisitionCostLot.create({ data: {
          purchaseOrderId: line.purchaseOrderId, purchaseOrderLineId: line.id, supplierId: line.purchaseOrder.supplierId, skuId: line.skuId,
          invoiceRef, invoiceLineRef, quantity: dto.quantity, unitCost, currency: EGP, idempotencyKey: dto.idempotencyKey, capturedBy: actorId,
        } });
        await tx.acquisitionCostEvent.create({ data: { lotId: lot.id, action: 'CAPTURED', actorId, current: AcquisitionCostService.snapshot(lot) } });
        const marginWarnings = await this.warnOnNegativeContribution(tx, line, unitCost);
        const after = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineId }, include: { allocations: true, costLots: true } });
        return { lot, replayed: false, marginWarnings, line: this.presentSummary(after) };
      }, { timeout: 30000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.acquisitionCostLot.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (raced && matches(raced)) return { lot: raced, replayed: true, marginWarnings: [] as MarginWarning[], line: await this.lineSummary(lineId) };
        throw new ConflictException({ code: 'DUPLICATE_INVOICE_LINE', message: `Invoice ${invoiceRef} is already recorded on this line` });
      }
      throw error;
    }
  }

  private async assertBarcodeIdentity(lineId: string, barcode: string) {
    const line = await this.prisma.purchaseOrderLine.findUnique({ where: { id: lineId }, select: { skuId: true } });
    if (!line) throw new NotFoundException('Purchase order line not found');
    const resolved = await this.identity.resolveBarcode(barcode);
    if (resolved.status !== 'resolved' || resolved.skuId !== line.skuId) {
      throw new ConflictException({ code: 'BARCODE_MISMATCH', message: 'The scanned barcode is not the SKU of this purchase order line' });
    }
  }

  /** Authorized reconciliation: the old value stays in the immutable history and an open payable moves by the exact difference, in one transaction. */
  async correct(lotId: string, dto: CorrectAcquisitionCostDto, actorId: string) {
    const reason = dto.reason.trim();
    if (reason.length < 5) throw new BadRequestException('A meaningful correction reason is required');
    if (dto.unitCost === undefined && dto.quantity === undefined && dto.invoiceRef === undefined) throw new BadRequestException('Nothing to correct');
    const nextCost = dto.unitCost !== undefined ? new Prisma.Decimal(dto.unitCost) : null;
    if (nextCost && (nextCost.lte(0) || nextCost.decimalPlaces() > 2)) throw new BadRequestException('Unit cost must be a positive EGP amount with at most 2 decimals');

    return this.prisma.$transaction(async tx => {
      const found = await tx.acquisitionCostLot.findUnique({ where: { id: lotId }, select: { purchaseOrderLineId: true } });
      if (!found) throw new NotFoundException('Cost lot not found');
      const line = await this.lockLine(tx, found.purchaseOrderLineId);
      const lot = line.costLots.find(row => row.id === lotId)!;
      if (lot.version !== dto.expectedVersion) throw new ConflictException({ code: 'COST_LOT_STALE', message: 'This cost lot changed; reload it before correcting', currentVersion: lot.version });
      const quantity = dto.quantity ?? lot.quantity;
      const unitCost = nextCost ?? lot.unitCost;
      const invoiceRef = dto.invoiceRef !== undefined ? AcquisitionCostService.normalizeInvoiceRef(dto.invoiceRef) : lot.invoiceRef;
      const others = line.costLots.filter(row => row.id !== lotId);
      if (others.some(row => row.invoiceRef === invoiceRef && row.invoiceLineRef === lot.invoiceLineRef)) {
        throw new ConflictException({ code: 'DUPLICATE_INVOICE_LINE', message: `Invoice ${invoiceRef} is already recorded on this line` });
      }
      const received = acceptedQuantity(line);
      const costedByOthers = others.reduce((sum, row) => sum + row.quantity, 0);
      if (costedByOthers + quantity > received) throw new ConflictException({ code: 'COST_QUANTITY_EXCEEDS_RECEIVED', message: `This line received ${received} unit(s) only` });

      const payable = await tx.supplierPayable.findUnique({ where: { purchaseOrderId: line.purchaseOrderId } });
      if (payable?.status === CLOSED_PAYABLE) {
        throw new ConflictException({ code: 'PAYABLE_CLOSED', message: 'This purchase order is already paid; record the difference as a supplier credit against a later payable' });
      }
      const delta = unitCost.mul(quantity).minus(lot.unitCost.mul(lot.quantity));
      const updated = await tx.acquisitionCostLot.update({ where: { id: lotId }, data: { quantity, unitCost, invoiceRef, version: { increment: 1 } } });
      await tx.acquisitionCostEvent.create({ data: { lotId, action: 'CORRECTED', actorId, reason, previous: AcquisitionCostService.snapshot(lot), current: AcquisitionCostService.snapshot(updated) } });

      if (payable && !delta.isZero()) {
        const next = payable.amount.plus(delta);
        if (next.isNegative()) throw new ConflictException({ code: 'PAYABLE_WOULD_BE_NEGATIVE', message: 'Credits already applied exceed the corrected goods value' });
        const basis = Array.isArray(payable.basis) ? (payable.basis as Array<Record<string, unknown>>).map(row => {
          if (row.lineId !== line.id) return row;
          const value = new Prisma.Decimal(String(row.lineAmount)).plus(delta);
          return { ...row, lineAmount: value.toFixed(2) };
        }) : payable.basis;
        await tx.supplierPayable.update({ where: { id: payable.id }, data: { amount: next.toDecimalPlaces(2), status: 'adjusted', basis: basis as Prisma.InputJsonValue } });
        await tx.payableAdjustment.create({ data: { payableId: payable.id, amount: delta, reason: `${COST_CORRECTION_REASON_PREFIX} lot ${lotId} - ${reason}`, actorId } });
      }
      const marginWarnings = await this.warnOnNegativeContribution(tx, line, unitCost);
      const after = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id }, include: { allocations: true, costLots: true } });
      return { lot: updated, marginWarnings, payableDelta: delta.toFixed(2), line: this.presentSummary(after) };
    }, { timeout: 30000 });
  }

  /** Raises a case the moment an invoice shows a unit bought above what the customer pays for it. The customer's price is only read. */
  private async warnOnNegativeContribution(tx: Tx, line: { id: string; skuId: string; allocations: Array<{ orderId: string; orderItemId: string; receivedQuantity: number }> }, unitCost: Prisma.Decimal): Promise<MarginWarning[]> {
    const linked = line.allocations.filter(link => link.receivedQuantity > 0);
    if (!linked.length) return [];
    const items = await tx.orderItem.findMany({ where: { id: { in: linked.map(link => link.orderItemId) } }, select: { id: true, orderId: true, quantity: true, price: true, discountAmount: true, lineTotal: true } });
    const warnings: MarginWarning[] = [];
    for (const item of items) {
      const unitNet = this.unitNetPrice(item);
      if (unitCost.lte(unitNet)) continue;
      const contribution = unitNet.minus(unitCost);
      const supportCase = await this.support.openOperationalException(tx, {
        dedupKey: `negative-contribution:${item.id}:${unitCost.toFixed(2)}`, category: 'sourcing', priority: 'high', orderId: item.orderId,
        title: 'Negative contribution on a received order line',
        description: `Order item ${item.id} (SKU ${line.skuId}) sells at ${unitNet.toFixed(2)} EGP net per unit but its invoice cost is ${unitCost.toFixed(2)} EGP (${contribution.toFixed(2)} EGP per unit). The customer's price is unchanged; decide with the supplier or adjust future pricing.`,
      });
      warnings.push({ orderId: item.orderId, orderItemId: item.id, unitNetPrice: unitNet.toFixed(2), unitCost: unitCost.toFixed(2), unitContribution: contribution.toFixed(2), supportCaseId: supportCase.id });
    }
    return warnings;
  }

  private unitNetPrice(item: { quantity: number; price: Prisma.Decimal; discountAmount: Prisma.Decimal | null; lineTotal: Prisma.Decimal | null }) {
    const total = item.lineTotal ?? item.price.mul(item.quantity).minus(item.discountAmount ?? 0);
    return total.div(item.quantity);
  }

  private presentSummary(line: LineWithCost) {
    const summary = summarizeLineCost(line);
    return { lineId: line.id, status: summary.status, receivedQuantity: summary.received, costedQuantity: summary.costed, pendingQuantity: summary.pending, capturedValue: summary.capturedValue.toFixed(2) };
  }

  private async lineSummary(lineId: string) {
    return this.presentSummary(await this.prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineId }, include: { allocations: true, costLots: true } }));
  }

  /** Hub and Finance queue: received lines and whether invoice evidence covers them. */
  async listLines(filter: { status?: LineCostStatus; purchaseOrderId?: string; take: number; skip: number }) {
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        ...(filter.purchaseOrderId ? { purchaseOrderId: filter.purchaseOrderId } : {}),
        OR: [{ allocations: { some: { receivedQuantity: { gt: 0 } } } }, { costLots: { some: {} } }],
      },
      orderBy: { updatedAt: 'desc' }, take: 500,
      include: { allocations: true, costLots: { orderBy: { capturedAt: 'asc' } }, purchaseOrder: { include: { supplier: { select: { id: true, name: true } }, payables: { select: { id: true, status: true, amount: true } } } } },
    });
    const labels = await this.catalog.getSkuLabels(lines.map(line => line.skuId));
    const rows = lines.map(line => {
      const summary = summarizeLineCost(line);
      return {
        purchaseOrderId: line.purchaseOrderId, lineId: line.id, skuId: line.skuId, sku: labels.get(line.skuId) ?? null,
        supplierId: line.purchaseOrder.supplierId, supplierName: line.purchaseOrder.supplier.name, purchaseOrderStatus: line.purchaseOrder.status,
        status: summary.status, receivedQuantity: summary.received, costedQuantity: summary.costed, pendingQuantity: summary.pending, capturedValue: summary.capturedValue.toFixed(2),
        lots: line.costLots.map(lot => ({ id: lot.id, invoiceRef: lot.invoiceRef, invoiceLineRef: lot.invoiceLineRef, quantity: lot.quantity, unitCost: lot.unitCost.toFixed(2), currency: lot.currency, version: lot.version, capturedAt: lot.capturedAt })),
        payable: line.purchaseOrder.payables[0] ? { id: line.purchaseOrder.payables[0].id, status: line.purchaseOrder.payables[0].status, amount: line.purchaseOrder.payables[0].amount.toFixed(2) } : null,
      };
    }).filter(row => !filter.status || row.status === filter.status);
    return { total: rows.length, items: rows.slice(filter.skip, filter.skip + filter.take) };
  }

  async history(lotId: string) {
    const lot = await this.prisma.acquisitionCostLot.findUnique({ where: { id: lotId }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    if (!lot) throw new NotFoundException('Cost lot not found');
    return lot;
  }

  /**
   * Actual item contribution of one customer order: order-line net price less invoice cost of the units received for it. A line whose cost is
   * still pending reports its known part and states it is incomplete; no estimate fills the gap. Delivery fees and COD are outside this figure.
   */
  async orderContribution(orderId: string) {
    const [items, links] = await Promise.all([
      this.prisma.orderItem.findMany({ where: { orderId }, select: { id: true, skuId: true, quantity: true, price: true, discountAmount: true, lineTotal: true, currency: true, lineState: true } }),
      this.prisma.purchaseOrderLineAllocation.findMany({ where: { orderId }, include: { line: { include: { allocations: true, costLots: true } } } }),
    ]);
    if (!items.length) throw new NotFoundException('Order not found');
    const rows = items.map(item => {
      const related = links.filter(link => link.orderItemId === item.id);
      const receivedQuantity = related.reduce((sum, link) => sum + link.receivedQuantity, 0);
      let cogs = new Prisma.Decimal(0);
      let costPending = false;
      for (const link of related) {
        if (link.receivedQuantity === 0) continue;
        const summary = summarizeLineCost(link.line);
        if (summary.status === 'COST_PENDING') { costPending = true; continue; }
        // The line's lots are shared by the orders it supplied; each receives the line's exact average per received unit.
        cogs = cogs.plus(summary.capturedValue.mul(link.receivedQuantity).div(summary.received));
      }
      const revenue = this.unitNetPrice(item).mul(receivedQuantity);
      return {
        orderItemId: item.id, skuId: item.skuId, quantity: item.quantity, receivedQuantity, unitNetPrice: this.unitNetPrice(item).toFixed(2),
        revenueOfReceived: revenue.toFixed(2), actualCogs: costPending ? null : cogs.toFixed(2), contribution: costPending ? null : revenue.minus(cogs).toFixed(2),
        costStatus: receivedQuantity === 0 ? 'NOT_RECEIVED' : costPending ? 'COST_PENDING' : 'COST_CAPTURED', negative: !costPending && revenue.minus(cogs).isNegative(),
      };
    });
    const complete = rows.every(row => row.costStatus === 'COST_CAPTURED');
    const sum = (key: 'actualCogs' | 'contribution') => complete ? rows.reduce((total, row) => total.plus(row[key]!), new Prisma.Decimal(0)).toFixed(2) : null;
    return { orderId, currency: EGP, basis: 'ITEM_NET_LESS_INVOICE_COST', complete, actualCogs: sum('actualCogs'), contribution: sum('contribution'), items: rows };
  }

  /**
   * Finance reporting: the same basis as `orderContribution` for many orders in two queries (active lines only). An order is `complete` only when
   * every active line has received units whose invoice cost is captured; otherwise it carries no cogs and no contribution, and nothing estimates it.
   */
  async contributionForOrders(orderIds: string[]): Promise<Map<string, OrderCostSummary>> {
    const result = new Map<string, OrderCostSummary>();
    for (let offset = 0; offset < orderIds.length; offset += 500) {
      const chunk = orderIds.slice(offset, offset + 500);
      const [items, links] = await Promise.all([
        this.prisma.orderItem.findMany({ where: { orderId: { in: chunk }, lineState: 'active' }, select: { id: true, orderId: true, quantity: true, price: true, discountAmount: true, lineTotal: true } }),
        this.prisma.purchaseOrderLineAllocation.findMany({ where: { orderId: { in: chunk } }, include: { line: { include: { allocations: true, costLots: true } } } }),
      ]);
      for (const orderId of chunk) {
        const orderItems = items.filter(item => item.orderId === orderId);
        let cogs = new Prisma.Decimal(0);
        let revenue = new Prisma.Decimal(0);
        let pendingLines = 0;
        let notReceivedLines = 0;
        for (const item of orderItems) {
          const related = links.filter(link => link.orderItemId === item.id);
          const received = related.reduce((sum, link) => sum + link.receivedQuantity, 0);
          if (received === 0) { notReceivedLines++; continue; }
          let linePending = false;
          for (const link of related) {
            if (link.receivedQuantity === 0) continue;
            const summary = summarizeLineCost(link.line);
            if (summary.status === 'COST_PENDING') { linePending = true; continue; }
            cogs = cogs.plus(summary.capturedValue.mul(link.receivedQuantity).div(summary.received));
          }
          if (linePending) pendingLines++;
          revenue = revenue.plus(this.unitNetPrice(item).mul(received));
        }
        const complete = orderItems.length > 0 && pendingLines === 0 && notReceivedLines === 0;
        result.set(orderId, {
          complete, pendingLines, notReceivedLines,
          actualCogs: complete ? cogs : null, contribution: complete ? revenue.minus(cogs) : null, revenueOfReceived: revenue,
        });
      }
    }
    return result;
  }
}

export interface OrderCostSummary {
  complete: boolean;
  pendingLines: number;
  notReceivedLines: number;
  actualCogs: Prisma.Decimal | null;
  contribution: Prisma.Decimal | null;
  revenueOfReceived: Prisma.Decimal;
}
