import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { cairoWallTime } from '../../sourcing/public';
import type { LossShares } from './loss-responsibility';

const cents = (value: unknown) => Math.round(Number(value) * 100);
const money = (c: number) => c / 100;

/** ShinaCare's share, in percent of net product sales; set by the owner (SHINACARE_COMMISSION_PERCENT). Unset = not agreed yet. */
export function commissionPercent(raw = process.env.SHINACARE_COMMISSION_PERCENT): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const percent = Number(raw);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null;
}

const monthStart = (month: string) => cairoWallTime(`${month}-01`, 0);
const nextMonth = (month: string) => {
  const [year, m] = month.split('-').map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
};
const previousMonth = (month: string) => {
  const [year, m] = month.split('-').map(Number);
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * ShinaCare's month-end statement with the hub pharmacy (owner decision 2026-10-25): the hub collects all cash and pays
 * the suppliers, ShinaCare takes a percentage of NET product sales (delivered, minus refunds paid) — not of profit, which
 * nobody can audit. Delivery fees are the hub's income, so they are outside the base; what ShinaCare absorbs of them
 * (the invoice-size discount, free delivery, a fee kept after an item was removed) and its share of return losses come off
 * its commission. Everything is read from what the system recorded, never from either side's word.
 */
@Injectable()
export class MonthlyStatementService {
  constructor(private readonly prisma: PrismaService) {}

  async monthly(month: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('month must be YYYY-MM');
    const from = monthStart(month);
    const to = monthStart(nextMonth(month));

    // ---- delivered orders: net goods and delivery fees -------------------------------------------------------------
    const events = await this.prisma.orderStatusEvent.findMany({ where: { status: 'delivered', createdAt: { gte: from, lt: to } }, select: { orderId: true } });
    const orderIds = [...new Set(events.map(e => e.orderId))];
    const [orders, collections] = orderIds.length ? await Promise.all([
      this.prisma.order.findMany({ where: { id: { in: orderIds } }, include: { checkoutQuote: true } }),
      this.prisma.paymentCollection.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true, expectedAmount: true } }),
    ]) : [[], []];
    const expectedByOrder = new Map(collections.map(c => [c.orderId, c.expectedAmount]));
    let goods = 0; let feeEntitlement = 0; let feePaid = 0;
    for (const order of orders) {
      const fee = cents(order.shippingFee);
      // COD: what the customer was finally asked to pay (amendments rewrite it); otherwise the order total.
      goods += cents(expectedByOrder.get(order.id) ?? order.totalAmount) - fee;
      const snapshot = (order.checkoutQuote?.snapshot ?? {}) as { deliveryFeeBase?: number };
      feeEntitlement += snapshot.deliveryFeeBase !== undefined ? cents(snapshot.deliveryFeeBase) : fee;
      feePaid += fee;
    }

    // ---- refunds paid out in the month --------------------------------------------------------------------------------
    const refunds = await this.prisma.refundTransaction.aggregate({ where: { status: 'succeeded', updatedAt: { gte: from, lt: to } }, _sum: { amount: true } });
    const refundsPaid = cents(refunds._sum.amount ?? 0);
    const netSales = goods - refundsPaid;

    // ---- return losses decided in the month ---------------------------------------------------------------------------------
    const prefixes = [previousMonth(month), month, nextMonth(month)];
    const candidates = await this.prisma.orderResolution.findMany({
      where: { type: 'return', OR: prefixes.map(prefix => ({ resolutionDetails: { path: ['responsibility', 'decidedAt'], string_starts_with: prefix } })) },
      include: { items: true },
    });
    const decided = candidates.filter(r => {
      const at = new Date(((r.resolutionDetails as { responsibility?: { decidedAt?: string } } | null)?.responsibility?.decidedAt) ?? 0);
      return at >= from && at < to;
    });
    const priceOf = new Map((await this.prisma.orderItem.findMany({
      where: { id: { in: decided.flatMap(r => r.items.map(i => i.orderItemId)) } }, select: { id: true, price: true },
    })).map(i => [i.id, i.price]));
    const byParty = { supplier: 0, hub: 0, shinacare: 0 };
    let lossTotal = 0; let writtenOff = 0; let returnedToSupplier = 0;
    for (const resolution of decided) {
      const details = resolution.resolutionDetails as { responsibility: { shares: LossShares | null; disposition: string | null } };
      const value = resolution.items.reduce((sum, item) => sum + item.quantity * cents(priceOf.get(item.orderItemId) ?? 0), 0);
      if (details.responsibility.disposition === 'WRITE_OFF') writtenOff++;
      if (details.responsibility.disposition === 'RETURN_TO_SUPPLIER') returnedToSupplier++;
      const shares = details.responsibility.shares;
      if (!shares) continue; // sealed and intact: nobody loses
      lossTotal += value;
      byParty.supplier += Math.round((value * shares.supplier) / 100);
      byParty.hub += Math.round((value * shares.hub) / 100);
      byParty.shinacare += Math.round((value * shares.shinacare) / 100);
    }

    // ---- ShinaCare's share ----------------------------------------------------------------------------------------------------
    const percent = commissionPercent();
    const commission = percent === null ? null : Math.round((netSales * percent) / 100);
    const absorbedDelivery = feeEntitlement - feePaid;
    return {
      month, from, to,
      ordersDelivered: orders.length,
      goodsDelivered: money(goods), refundsPaid: money(refundsPaid), netSales: money(netSales),
      delivery: { hubEntitlement: money(feeEntitlement), paidByCustomers: money(feePaid), absorbedByShinaCare: money(absorbedDelivery) },
      returnLosses: {
        returns: decided.length, total: money(lossTotal), writtenOff, returnedToSupplier,
        bySupplier: money(byParty.supplier), byHub: money(byParty.hub), byShinaCare: money(byParty.shinacare),
      },
      commission: { percent, amount: commission === null ? null : money(commission) },
      // Positive: the hub pays ShinaCare. Negative: ShinaCare owes the hub (its subsidies and losses exceed its commission).
      shinaCareNet: commission === null ? null : money(commission - absorbedDelivery - byParty.shinacare),
      notes: [
        percent === null ? 'The commission percentage is not set (SHINACARE_COMMISSION_PERCENT), so no amount is calculated.' : null,
        'Order-level promotion discounts are not attributed to either side yet.',
        'Return losses are valued at the selling price of the returned items.',
      ].filter(Boolean) as string[],
    };
  }
}

export type MonthlyStatement = Prisma.PromiseReturnType<MonthlyStatementService['monthly']>;
