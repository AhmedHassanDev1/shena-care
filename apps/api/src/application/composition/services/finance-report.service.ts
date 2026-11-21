import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SETTING_KEYS } from '../../../platform/settings/runtime-settings';
import { FinanceExpenseService } from '../../../modules/operations/services/finance-expense.service';
import { SettingsService } from '../../../modules/operations/settings/settings.service';
import { addDays, cairoYmd, daysBetween, resolveRange, ReportRange } from './finance-dates';
import { ProfitService } from './profit.service';

/**
 * Finance reporting from the records the platform already keeps. There is ONE definition of every money figure and it lives in the profit
 * model (`profit-model.ts`, assembled by `ProfitService.compute`): `summary` is that same computation over a date range, so the Finance page
 * (a month) and this report (any range) can never disagree. Cash positions come from `readCashPosition`, shared with the Admin overview.
 * Nothing is invented: a cost that has not been captured stays null and the distributable profit is withheld.
 */

const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const money = (valueInCents: number) => valueInCents / 100;
const SETTLED = ['settled', 'short', 'over'];

export type TransactionType = 'SALE' | 'COD_SETTLEMENT' | 'REFUND' | 'SUPPLIER_INVOICE' | 'EXPENSE';
export const TRANSACTION_TYPES: TransactionType[] = ['SALE', 'COD_SETTLEMENT', 'REFUND', 'SUPPLIER_INVOICE', 'EXPENSE'];

interface DeliveredOrder {
  id: string;
  orderNumber: string;
  deliveredAt: Date;
  paymentMethod: string;
  /** Goods billed after every discount and coupon (order total − delivery fee). */
  goods: number; // cents
  /** Order-level discount actually deducted (coupons); a compare-at saving is already inside the price and is only informational. */
  discounts: number;
  listPriceSaving: number;
  deliveryFee: number;
  total: number;
  collection: { status: string; expected: number; collected: number | null } | null;
}

@Injectable()
export class FinanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: FinanceExpenseService,
    private readonly settings: SettingsService,
    private readonly profit: ProfitService,
  ) {}

  range(from?: string, to?: string): ReportRange {
    return resolveRange(from, to);
  }

  /** Orders delivered inside the range (dated by their first delivered status event) that are still delivered. */
  private async deliveredOrders(range: ReportRange): Promise<DeliveredOrder[]> {
    const events = await this.prisma.orderStatusEvent.findMany({
      where: { status: 'delivered', createdAt: { gte: range.start, lt: range.end } },
      select: { orderId: true, createdAt: true }, orderBy: { createdAt: 'asc' },
    });
    const deliveredAt = new Map<string, Date>();
    for (const event of events) if (!deliveredAt.has(event.orderId)) deliveredAt.set(event.orderId, event.createdAt);
    if (!deliveredAt.size) return [];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: [...deliveredAt.keys()] }, status: 'delivered' },
      select: {
        id: true, orderNumber: true, paymentMethod: true, subtotal: true, shippingFee: true, totalAmount: true,
        items: { where: { lineState: 'active' }, select: { discountAmount: true, lineTotal: true, price: true, quantity: true } },
        paymentCollection: { select: { status: true, expectedAmount: true, collectedAmount: true } },
      },
    });
    return orders.map((order): DeliveredOrder => {
      const gross = order.items.reduce((sum, item) => sum + cents(item.lineTotal ?? Number(item.price) * item.quantity), 0);
      const goods = Math.max(0, cents(order.totalAmount) - cents(order.shippingFee));
      return {
        id: order.id, orderNumber: order.orderNumber, deliveredAt: deliveredAt.get(order.id)!, paymentMethod: order.paymentMethod,
        goods, discounts: Math.max(0, gross - goods), listPriceSaving: order.items.reduce((sum, item) => sum + cents(item.discountAmount), 0),
        deliveryFee: cents(order.shippingFee), total: cents(order.totalAmount),
        collection: order.paymentCollection && order.paymentCollection.status !== 'voided'
          ? { status: order.paymentCollection.status, expected: cents(order.paymentCollection.expectedAmount), collected: order.paymentCollection.collectedAmount === null ? null : cents(order.paymentCollection.collectedAmount) }
          : null,
      };
    });
  }

  /**
   * The same figures the Finance page shows, for any date range: net sales after every discount and coupon, delivery revenue, actual product /
   * delivery / packaging cost, confirmed damages, approved direct costs, the distributable profit and its split, what is payable now (cash
   * counted) and the cash position. `supplierCosts` is information about supplier-PO invoices (the supplier-PO sourcing mode); it is not used
   * in any profit figure.
   */
  async summary(range: ReportRange) {
    const percent = this.settings.effective<number>(SETTING_KEYS.profitSharePercent);
    const [{ result, cash }, lots, payablesOpen, payablesPaid] = await Promise.all([
      this.profit.compute(range, percent),
      this.prisma.acquisitionCostLot.findMany({ where: { capturedAt: { gte: range.start, lt: range.end } }, select: { quantity: true, unitCost: true, invoiceRef: true } }),
      this.prisma.supplierPayable.aggregate({ where: { status: { in: ['open', 'ready_to_pay', 'disputed'] } }, _sum: { amount: true }, _count: true }),
      this.prisma.supplierPayable.aggregate({ where: { status: 'paid', paidAt: { gte: range.start, lt: range.end } }, _sum: { amount: true }, _count: true }),
    ]);
    const figures = this.profit.presentFigures(`${range.from}..${range.to}`, range, result);
    const billed = result.revenue.netSales + result.revenue.shippingRevenue;
    return {
      ...figures,
      range: { from: range.from, to: range.to, days: range.days },
      basisNotes: { sales: 'RECORDED', cost: 'ACTUAL (estimated delivery where marked)', cash: 'LIVE', profit: 'SAME_AS_FINANCE_PAGE' },
      sales: {
        deliveredOrders: result.eligibleOrders, grossSales: figures.revenue.grossSales, discounts: figures.revenue.discounts, netSales: figures.revenue.netSales,
        productRefunds: figures.revenue.productRefunds, netSalesAfterRefunds: figures.revenue.netSalesAfterRefunds,
        shippingRevenue: figures.revenue.shippingRevenueNet, billedTotal: money(billed),
        averageOrderValue: result.eligibleOrders ? money(Math.round(billed / result.eligibleOrders)) : null,
      },
      profitability: {
        grossProfit: figures.grossProfit,
        grossMarginPercent: result.grossProfit !== null && result.revenue.netSalesAfterRefunds > 0 ? Math.round((result.grossProfit / result.revenue.netSalesAfterRefunds) * 1000) / 10 : null,
        distributableMarginPercent: result.distributableProfit !== null && result.revenue.total > 0 ? Math.round((result.distributableProfit / result.revenue.total) * 1000) / 10 : null,
      },
      cash,
      supplierCosts: {
        invoicedInPeriod: money(lots.reduce((sum, lot) => sum + Math.round(Number(lot.unitCost) * 100) * lot.quantity, 0)),
        invoiceLines: lots.length,
        invoices: new Set(lots.map(lot => lot.invoiceRef)).size,
        payablesOutstanding: money(cents(payablesOpen._sum.amount)), payablesOutstandingCount: payablesOpen._count,
        payablesPaidInPeriod: money(cents(payablesPaid._sum.amount)),
      },
      operatingResult: {
        value: figures.distributableProfit, status: figures.status === 'COMPLETE' ? 'RECORDED' : 'INCOMPLETE', missing: result.missing.map(item => item.code),
        formula: 'net sales + shipping revenue − actual product cost − delivery − packaging − confirmed damages − approved direct costs',
      },
    };
  }

  /** Daily (or weekly past 62 days) series for the charts; every number is a recorded fact of that day. */
  async series(range: ReportRange) {
    const [delivered, refunds, batches, expenseRows] = await Promise.all([
      this.deliveredOrders(range),
      this.prisma.refundTransaction.findMany({ where: { status: 'succeeded', updatedAt: { gte: range.start, lt: range.end } }, select: { amount: true, updatedAt: true } }),
      this.prisma.courierSettlementBatch.findMany({ where: { settledAt: { gte: range.start, lt: range.end } }, select: { totalCollected: true, settledAt: true } }),
      this.expenses.occurrencesBetween(range.from, range.to),
    ]);
    const weekly = range.days > 62;
    const bucketOf = (ymd: string) => weekly ? addDays(range.from, Math.floor(daysBetween(range.from, ymd) / 7) * 7) : ymd;
    const buckets = new Map<string, { date: string; revenue: number; orders: number; expenses: number; refunds: number; codSettled: number }>();
    const step = weekly ? 7 : 1;
    for (let offset = 0; offset < range.days; offset += step) {
      const date = addDays(range.from, offset);
      buckets.set(date, { date, revenue: 0, orders: 0, expenses: 0, refunds: 0, codSettled: 0 });
    }
    const at = (ymd: string) => buckets.get(bucketOf(ymd));
    for (const order of delivered) {
      const bucket = at(cairoYmd(order.deliveredAt));
      if (!bucket) continue;
      bucket.revenue += order.total; bucket.orders += 1;
    }
    for (const refund of refunds) { const b = at(cairoYmd(refund.updatedAt)); if (b) b.refunds += cents(refund.amount); }
    // Cash the hub counted that day (settlement level); a shortage is on the settlement, not on an order.
    for (const batch of batches) { const b = at(cairoYmd(batch.settledAt)); if (b) b.codSettled += cents(batch.totalCollected); }
    // Only approved DIRECT costs reduce the shared profit; platform expenses are listed in the transactions, never charted as shared cost.
    for (const row of expenseRows) { if (row.kind !== 'DIRECT' || !row.approved) continue; const b = at(row.date); if (b) b.expenses += cents(row.amount); }
    return {
      currency: 'EGP', granularity: weekly ? 'week' : 'day',
      points: [...buckets.values()].map(bucket => ({
        date: bucket.date, orders: bucket.orders,
        revenue: money(bucket.revenue), expenses: money(bucket.expenses),
        refunds: money(bucket.refunds), codSettled: money(bucket.codSettled),
      })),
    };
  }

  /** Order-level breakdown of delivered orders: what the customer paid, the discount actually deducted and the cash status. */
  async orders(range: ReportRange, page: { limit: number; offset: number }) {
    const all = (await this.deliveredOrders(range)).sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime());
    const slice = all.slice(page.offset, page.offset + page.limit);
    return {
      currency: 'EGP', total: all.length, limit: page.limit, offset: page.offset,
      items: slice.map(order => ({
        orderId: order.id, orderNumber: order.orderNumber, deliveredAt: order.deliveredAt.toISOString(), paymentMethod: order.paymentMethod,
        goods: money(order.goods), discounts: money(order.discounts), listPriceSaving: money(order.listPriceSaving), deliveryFee: money(order.deliveryFee), total: money(order.total),
        cod: order.collection ? { status: order.collection.status, expected: money(order.collection.expected), collected: order.collection.collected === null ? null : money(order.collection.collected), settled: SETTLED.includes(order.collection.status) } : null,
      })),
    };
  }

  /** One list of financial movements, newest first. Amounts are signed: money in is positive, money out negative. */
  async transactions(range: ReportRange, options: { type?: TransactionType; limit: number }) {
    const want = (type: TransactionType) => !options.type || options.type === type;
    const cap = 300;
    const [sales, refunds, batches, lots, expenseRows] = await Promise.all([
      want('SALE') ? this.deliveredOrders(range) : [],
      want('REFUND') ? this.prisma.refundTransaction.findMany({ where: { status: 'succeeded', updatedAt: { gte: range.start, lt: range.end } }, include: { order: { select: { orderNumber: true } } }, orderBy: { updatedAt: 'desc' }, take: cap }) : [],
      want('COD_SETTLEMENT') ? this.prisma.courierSettlementBatch.findMany({ where: { settledAt: { gte: range.start, lt: range.end } }, orderBy: { settledAt: 'desc' }, take: cap }) : [],
      want('SUPPLIER_INVOICE') ? this.prisma.acquisitionCostLot.findMany({ where: { capturedAt: { gte: range.start, lt: range.end } }, select: { id: true, invoiceRef: true, quantity: true, unitCost: true, capturedAt: true }, orderBy: { capturedAt: 'desc' }, take: cap }) : [],
      want('EXPENSE') ? this.expenses.occurrencesBetween(range.from, range.to) : [],
    ]);
    const rows = [
      ...sales.map(order => ({ id: `sale:${order.id}`, type: 'SALE' as const, date: order.deliveredAt.toISOString(), amount: money(order.total), reference: order.orderNumber, orderId: order.id, basis: 'RECORDED' as const })),
      ...refunds.map(refund => ({ id: `refund:${refund.id}`, type: 'REFUND' as const, date: refund.updatedAt.toISOString(), amount: -money(cents(refund.amount)), reference: refund.order.orderNumber, orderId: refund.orderId, basis: 'RECORDED' as const })),
      ...batches.map(batch => ({ id: `settlement:${batch.id}`, type: 'COD_SETTLEMENT' as const, date: batch.settledAt.toISOString(), amount: money(cents(batch.totalCollected)), reference: batch.reference, orderId: null, basis: 'RECONCILED' as const })),
      ...lots.map(lot => ({ id: `invoice:${lot.id}`, type: 'SUPPLIER_INVOICE' as const, date: lot.capturedAt.toISOString(), amount: -money(Math.round(Number(lot.unitCost) * 100) * lot.quantity), reference: lot.invoiceRef, orderId: null, basis: 'RECORDED' as const })),
      ...expenseRows.map(row => ({ id: `expense:${row.expenseId}:${row.date}`, type: 'EXPENSE' as const, date: `${row.date}T00:00:00.000Z`, amount: -money(cents(row.amount)), reference: `${row.kind} · ${row.category} · ${row.description}`, orderId: null, basis: 'RECORDED' as const })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return { currency: 'EGP', total: rows.length, items: rows.slice(0, Math.min(options.limit, cap)) };
  }
}
