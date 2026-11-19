import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderAdjustmentStatus, OrderQuantityAdjustment, Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SupplyPlanService } from '../../sourcing/public';

const OPEN_ORDER_STATUSES = ['placed', 'confirmed', 'packing'];
const cents = (value: Prisma.Decimal.Value) => Math.round(Number(value) * 100);
const money = (c: number) => c / 100;

export interface QuantityAdjustmentView {
  id: string; orderId: string; orderItemId: string; status: OrderAdjustmentStatus
  /** What the customer ordered on this line. */
  orderedQuantity: number
  /** Units the Hub reported as not available. */
  missingQuantity: number
  /** What the line becomes when an Admin applies the adjustment. */
  newQuantity: number
  reason: string | null
  amounts: { codBefore: number | null; codAfter: number | null; totalBefore: number | null; totalAfter: number | null; delta: number | null; currency: string | null }
  proposedBy: string; proposedAt: Date; decidedBy: string | null; decidedAt: Date | null; decisionNote: string | null
}

const view = (row: OrderQuantityAdjustment): QuantityAdjustmentView => {
  const codBefore = row.codBefore === null ? null : Number(row.codBefore);
  const codAfter = row.codAfter === null ? null : Number(row.codAfter);
  return {
    id: row.id, orderId: row.orderId, orderItemId: row.orderItemId, status: row.status,
    orderedQuantity: row.orderedQuantity, missingQuantity: row.missingQuantity, newQuantity: row.orderedQuantity - row.missingQuantity,
    reason: row.reason,
    amounts: {
      codBefore, codAfter, totalBefore: row.totalBefore === null ? null : Number(row.totalBefore), totalAfter: row.totalAfter === null ? null : Number(row.totalAfter),
      delta: codBefore === null || codAfter === null ? null : money(cents(codAfter) - cents(codBefore)), currency: row.currency,
    },
    proposedBy: row.proposedBy, proposedAt: row.proposedAt, decidedBy: row.decidedBy, decidedAt: row.decidedAt, decisionNote: row.decisionNote,
  };
};

/**
 * Partial fulfillment: fewer units exist than the customer ordered. Ordering owns the order, so it owns this change. The Hub only REPORTS a
 * shortage (a proposal that changes nothing); an authorized Admin APPLIES it, and only then do the line quantity, the order totals, the COD
 * expectation and the sourcing requirement follow, together, in one transaction. The original quantity and money stay on the adjustment
 * (before / after) so the order can always be audited. Cash orders whose money has not been touched yet only: an online payment or a
 * collected amount needs the refund flow, never an edit here. Delivery fee and order-level promotions are not re-evaluated.
 */
@Injectable()
export class OrderQuantityAdjustmentService {
  constructor(private readonly prisma: PrismaService, private readonly supplyPlan: SupplyPlanService) {}

  // Same per-order exclusivity the receiving command uses, so a count read here cannot move under us.
  private async lock(tx: Prisma.TransactionClient, orderId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(44081, hashtext(${orderId}))::text AS locked`;
  }

  /** The order and line must still be open for a cash-only, untouched-money adjustment. Returns the figures the adjustment is computed from. */
  private async assertAdjustable(tx: Prisma.TransactionClient, orderId: string, orderItemId: string) {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, paymentCollection: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new ConflictException({ code: 'ORDER_NOT_OPEN', message: 'This order is cancelled or closed' });
    const item = order.items.find(i => i.id === orderItemId && i.lineState === 'active');
    if (!item) throw new NotFoundException('Order line not found');
    if (order.paymentMethod !== 'COD') {
      throw new ConflictException({ code: 'REFUND_FLOW_REQUIRED', message: 'This order was paid online; a shortage must go through the refund flow, not a quantity edit' });
    }
    if (order.paymentCollection && order.paymentCollection.status !== 'expected') {
      throw new ConflictException({ code: 'COLLECTION_ALREADY_STARTED', message: 'Cash for this order is already collected or settled; its amount can no longer change' });
    }
    const lineCents = cents(item.lineTotal ?? item.price.mul(item.quantity));
    return { order, item, lineCents };
  }

  private figures(order: { totalAmount: Prisma.Decimal; codAmount: Prisma.Decimal | null; subtotal: Prisma.Decimal | null },
    item: { quantity: number; discountAmount: Prisma.Decimal | null }, lineCents: number, newQuantity: number) {
    const newLineCents = Math.round((lineCents * newQuantity) / item.quantity);
    const delta = lineCents - newLineCents;
    const newDiscount = item.discountAmount === null ? null : money(Math.round((cents(item.discountAmount) * newQuantity) / item.quantity));
    return {
      newLineCents, delta, newDiscount,
      codBefore: money(cents(order.codAmount ?? order.totalAmount)), codAfter: money(cents(order.codAmount ?? order.totalAmount) - delta),
      totalBefore: money(cents(order.totalAmount)), totalAfter: money(cents(order.totalAmount) - delta),
    };
  }

  /** The Hub reports that `missingQuantity` units of a line do not exist. Changes nothing but the proposal; a newer proposal supersedes an older open one. */
  async propose(input: { orderId: string; orderItemId: string; missingQuantity: number; reason?: string; locationId: string; clientRequestId: string; actorId: string }) {
    const prior = await this.prisma.orderQuantityAdjustment.findUnique({ where: { clientRequestId: input.clientRequestId } });
    if (prior) {
      if (prior.orderId !== input.orderId || prior.orderItemId !== input.orderItemId || prior.missingQuantity !== input.missingQuantity || prior.proposedBy !== input.actorId) {
        throw new ConflictException({ code: 'REQUEST_ID_REUSED', message: 'This request id was already used for another shortage' });
      }
      return view(prior);
    }
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, input.orderId);
      const { order, item, lineCents } = await this.assertAdjustable(tx, input.orderId, input.orderItemId);
      if (input.missingQuantity < 1 || input.missingQuantity >= item.quantity) {
        throw new BadRequestException(input.missingQuantity >= item.quantity
          ? 'A shortage of the whole line is a cancellation of that item, not a quantity adjustment'
          : 'The missing quantity must be at least 1');
      }
      await tx.orderQuantityAdjustment.updateMany({ where: { orderItemId: item.id, status: 'proposed' }, data: { status: 'superseded', decidedAt: new Date(), decidedBy: input.actorId, decisionNote: 'Replaced by a newer report' } });
      const newQuantity = item.quantity - input.missingQuantity;
      const f = this.figures(order, item, lineCents, newQuantity);
      const created = await tx.orderQuantityAdjustment.create({ data: {
        orderId: order.id, orderItemId: item.id, locationId: input.locationId, clientRequestId: input.clientRequestId, status: 'proposed',
        orderedQuantity: item.quantity, missingQuantity: input.missingQuantity, reason: input.reason?.trim() || null, proposedBy: input.actorId,
        before: { quantity: item.quantity, price: Number(item.price), lineTotal: money(lineCents), discountAmount: item.discountAmount === null ? null : Number(item.discountAmount) },
        after: { quantity: newQuantity, price: Number(item.price), lineTotal: money(f.newLineCents), discountAmount: f.newDiscount },
        codBefore: f.codBefore, codAfter: f.codAfter, totalBefore: f.totalBefore, totalAfter: f.totalAfter, currency: order.currency,
      } });
      return view(created);
    });
  }

  /**
   * Applies a proposal (Admin only, enforced by the route). `receivedQuantity` is what the Hub has physically received for the line: the line can
   * never drop below it. Idempotent: an applied adjustment returns itself.
   */
  async approve(adjustmentId: string, actorId: string, note: string | undefined, receivedQuantity: number) {
    return this.prisma.$transaction(async tx => {
      const found = await tx.orderQuantityAdjustment.findUnique({ where: { id: adjustmentId } });
      if (!found) throw new NotFoundException('Adjustment not found');
      await this.lock(tx, found.orderId);
      const adj = await tx.orderQuantityAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
      if (adj.status === 'applied') return view(adj);
      if (adj.status !== 'proposed') throw new ConflictException({ code: 'ADJUSTMENT_NOT_OPEN', message: `This shortage report is ${adj.status}` });

      const { order, item, lineCents } = await this.assertAdjustable(tx, adj.orderId, adj.orderItemId);
      if (item.quantity !== adj.orderedQuantity) {
        throw new ConflictException({ code: 'LINE_CHANGED', message: 'The order line changed after this shortage was reported; report it again' });
      }
      const newQuantity = item.quantity - adj.missingQuantity;
      if (receivedQuantity > newQuantity) {
        throw new ConflictException({ code: 'RECEIVED_EXCEEDS_NEW_QUANTITY', message: 'More units were received than the adjusted quantity; correct the received units first' });
      }
      const f = this.figures(order, item, lineCents, newQuantity);
      await tx.orderItem.update({ where: { id: item.id }, data: { quantity: newQuantity, lineTotal: money(f.newLineCents), discountAmount: f.newDiscount } });
      await tx.order.update({ where: { id: order.id }, data: {
        totalAmount: f.totalAfter,
        ...(order.subtotal === null ? {} : { subtotal: money(cents(order.subtotal) - f.delta) }),
        ...(order.codAmount === null ? {} : { codAmount: f.codAfter }),
      } });
      if (order.paymentCollection) {
        await tx.paymentCollection.update({ where: { orderId: order.id }, data: { expectedAmount: money(cents(order.paymentCollection.expectedAmount) - f.delta) } });
      }
      await this.supplyPlan.reduceRequirement(tx, order.id, item.id, newQuantity);
      const applied = await tx.orderQuantityAdjustment.update({ where: { id: adj.id }, data: {
        status: 'applied', decidedBy: actorId, decidedAt: new Date(), decisionNote: note?.trim() || null,
        before: { quantity: item.quantity, price: Number(item.price), lineTotal: money(lineCents), discountAmount: item.discountAmount === null ? null : Number(item.discountAmount) },
        after: { quantity: newQuantity, price: Number(item.price), lineTotal: money(f.newLineCents), discountAmount: f.newDiscount },
        codBefore: f.codBefore, codAfter: f.codAfter, totalBefore: f.totalBefore, totalAfter: f.totalAfter,
      } });
      return view(applied);
    }, { timeout: 30000 });
  }

  /** An Admin declines the report: nothing about the order changes and the Hub keeps looking for the missing units. */
  async reject(adjustmentId: string, actorId: string, note: string | undefined) {
    return this.prisma.$transaction(async tx => {
      const found = await tx.orderQuantityAdjustment.findUnique({ where: { id: adjustmentId } });
      if (!found) throw new NotFoundException('Adjustment not found');
      await this.lock(tx, found.orderId);
      const adj = await tx.orderQuantityAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
      if (adj.status === 'rejected') return view(adj);
      if (adj.status !== 'proposed') throw new ConflictException({ code: 'ADJUSTMENT_NOT_OPEN', message: `This shortage report is ${adj.status}` });
      return view(await tx.orderQuantityAdjustment.update({ where: { id: adj.id }, data: { status: 'rejected', decidedBy: actorId, decidedAt: new Date(), decisionNote: note?.trim() || null } }));
    });
  }

  /** Every adjustment of the given orders (open and decided), oldest first: the desk shows the open one and the original quantity of applied ones. */
  async listForOrders(orderIds: string[]): Promise<QuantityAdjustmentView[]> {
    if (!orderIds.length) return [];
    const rows = await this.prisma.orderQuantityAdjustment.findMany({ where: { orderId: { in: orderIds }, status: { in: ['proposed', 'applied'] } }, orderBy: { proposedAt: 'asc' } });
    return rows.map(view);
  }

  async get(adjustmentId: string): Promise<QuantityAdjustmentView & { locationId: string | null }> {
    const row = await this.prisma.orderQuantityAdjustment.findUnique({ where: { id: adjustmentId } });
    if (!row) throw new NotFoundException('Adjustment not found');
    return { ...view(row), locationId: row.locationId };
  }
}
