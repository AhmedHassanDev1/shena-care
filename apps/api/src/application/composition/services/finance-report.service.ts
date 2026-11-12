import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SETTING_KEYS } from '../../../platform/settings/runtime-settings';
import { AcquisitionCostService } from '../../../modules/sourcing/public';
import { FinanceExpenseService } from '../../../modules/operations/services/finance-expense.service';
import { SettingsService } from '../../../modules/operations/settings/settings.service';
import { addDays, cairoYmd, daysBetween, resolveRange, ReportRange } from './finance-dates';

/**
 * Finance reporting from the records the platform already keeps. Every figure carries its basis:
 *   RECORDED   - taken from a stored document (delivered order, supplier invoice, expense, refund, settlement batch)
 *   RECONCILED - cash the Hub counted and settled
 *   ESTIMATED  - configured per-order cost x orders; shown apart and never added to a recorded total
 * Nothing is invented: a cost that has not been captured stays null, and the operating result is withheld until every delivered
 * order in the period has its supplier invoice cost.
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
  goods: number; // cents
  discounts: number;
  deliveryFee: number;
  total: number;
  collection: { status: string; expected: number; collected: number | null } | null;
}

@Injectable()
export class FinanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: AcquisitionCostService,
    private readonly expenses: FinanceExpenseService,
    private readonly settings: SettingsService,
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
    return orders.map((order): DeliveredOrder => ({
      id: order.id, orderNumber: order.orderNumber, deliveredAt: deliveredAt.get(order.id)!, paymentMethod: order.paymentMethod,
      goods: order.subtotal !== null ? cents(order.subtotal) : order.items.reduce((sum, item) => sum + cents(item.lineTotal ?? Number(item.price) * item.quantity), 0),
      discounts: order.items.reduce((sum, item) => sum + cents(item.discountAmount), 0),
      deliveryFee: cents(order.shippingFee), total: cents(order.totalAmount),
      collection: order.paymentCollection && order.paymentCollection.status !== 'voided'
        ? { status: order.paymentCollection.status, expected: cents(order.paymentCollection.expectedAmount), collected: order.paymentCollection.collectedAmount === null ? null : cents(order.paymentCollection.collectedAmount) }
        : null,
    }));
  }

  async summary(range: ReportRange) {
    const [delivered, lots, payablesOpen, payablesPaid, refunds, batches, expenseRows] = await Promise.all([
      this.deliveredOrders(range),
      this.prisma.acquisitionCostLot.findMany({ where: { capturedAt: { gte: range.start, lt: range.end } }, select: { quantity: true, unitCost: true, invoiceRef: true } }),
      this.prisma.supplierPayable.aggregate({ where: { status: { in: ['open', 'ready_to_pay', 'disputed'] } }, _sum: { amount: true }, _count: true }),
      this.prisma.supplierPayable.aggregate({ where: { status: 'paid', paidAt: { gte: range.start, lt: range.end } }, _sum: { amount: true }, _count: true }),
      this.prisma.refundTransaction.aggregate({ where: { status: 'succeeded', updatedAt: { gte: range.start, lt: range.end } }, _sum: { amount: true }, _count: true }),
      this.prisma.courierSettlementBatch.findMany({ where: { settledAt: { gte: range.start, lt: range.end } }, select: { totalExpected: true, totalCollected: true, fees: true, netSettled: true } }),
      this.expenses.occurrencesBetween(range.from, range.to),
    ]);
    const costByOrder = await this.costs.contributionForOrders(delivered.map(order => order.id));

    const goods = delivered.reduce((sum, order) => sum + order.goods, 0);
    const deliveryFees = delivered.reduce((sum, order) => sum + order.deliveryFee, 0);
    const discounts = delivered.reduce((sum, order) => sum + order.discounts, 0);
    const billed = delivered.reduce((sum, order) => sum + order.total, 0);

    // Supplier cost coverage: only orders whose every active line has a captured invoice cost carry a cost and a profit.
    const costed = delivered.filter(order => costByOrder.get(order.id)?.complete);
    const pendingOrders = delivered.filter(order => (costByOrder.get(order.id)?.pendingLines ?? 0) > 0).length;
    const notReceivedOrders = delivered.filter(order => !costByOrder.get(order.id)?.complete && (costByOrder.get(order.id)?.pendingLines ?? 0) === 0).length;
    const cogs = costed.reduce((sum, order) => sum + cents(costByOrder.get(order.id)!.actualCogs), 0);
    const costedRevenue = costed.reduce((sum, order) => sum + cents(costByOrder.get(order.id)!.revenueOfReceived), 0);
    const grossProfit = costedRevenue - cogs;
    const coverageComplete = delivered.length > 0 && costed.length === delivered.length;

    const cod = delivered.filter(order => order.paymentMethod === 'COD' && order.collection);
    const sumCod = (filter: (status: string) => boolean, pick: (c: NonNullable<DeliveredOrder['collection']>) => number) =>
      cod.filter(order => filter(order.collection!.status)).reduce((sum, order) => sum + pick(order.collection!), 0);
    const reconciledCollected = sumCod(status => SETTLED.includes(status), c => c.collected ?? 0);
    const reconciledExpected = sumCod(status => SETTLED.includes(status), c => c.expected);

    const refundsCents = cents(refunds._sum.amount);
    const courierFees = batches.reduce((sum, batch) => sum + cents(batch.fees), 0);
    const expenseTotal = expenseRows.reduce((sum, row) => sum + cents(row.amount), 0);
    const byCategory = new Map<string, number>();
    for (const row of expenseRows) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + cents(row.amount));

    const deliveryCostUnit = this.settings.effective<number | null>(SETTING_KEYS.deliveryInternalCost);
    const cartonUnit = this.settings.effective<number | null>(SETTING_KEYS.cartonCost);
    const labelUnit = this.settings.effective<number | null>(SETTING_KEYS.labelCost);
    const packagingConfigured = cartonUnit !== null || labelUnit !== null;

    const missing: string[] = [];
    if (!delivered.length) missing.push('NO_DELIVERED_ORDERS');
    if (delivered.length && costed.length < delivered.length) missing.push('SUPPLIER_COST_PENDING');
    const result = coverageComplete
      ? grossProfit + deliveryFees - refundsCents - courierFees - expenseTotal
      : null;

    return {
      currency: 'EGP',
      range: { from: range.from, to: range.to, days: range.days },
      basisNotes: { sales: 'RECORDED', cod: 'RECONCILED', supplierCost: 'RECORDED', estimates: 'ESTIMATED' },
      sales: {
        deliveredOrders: delivered.length, goodsRevenue: money(goods), deliveryFeeRevenue: money(deliveryFees), billedTotal: money(billed),
        discountsGiven: money(discounts), averageOrderValue: delivered.length ? money(Math.round(billed / delivered.length)) : null,
      },
      cod: {
        orders: cod.length,
        expected: money(sumCod(() => true, c => c.expected)),
        notYetCollected: money(sumCod(status => status === 'expected', c => c.expected)),
        withDrivers: money(sumCod(status => status === 'collected', c => c.expected)),
        disputed: money(sumCod(status => status === 'disputed', c => c.expected)),
        outstanding: money(sumCod(status => ['expected', 'collected', 'disputed'].includes(status), c => c.expected)),
        reconciled: money(reconciledCollected),
        reconciledOrders: cod.filter(order => SETTLED.includes(order.collection!.status)).length,
        variance: money(reconciledCollected - reconciledExpected),
        settlementBatches: batches.length,
      },
      supplierCosts: {
        invoicedInPeriod: money(lots.reduce((sum, lot) => sum + Math.round(Number(lot.unitCost) * 100) * lot.quantity, 0)),
        invoiceLines: lots.length,
        invoices: new Set(lots.map(lot => lot.invoiceRef)).size,
        payablesOutstanding: money(cents(payablesOpen._sum.amount)), payablesOutstandingCount: payablesOpen._count,
        payablesPaidInPeriod: money(cents(payablesPaid._sum.amount)),
      },
      profitability: {
        ordersWithCost: costed.length, ordersCostPending: pendingOrders, ordersNotReceived: notReceivedOrders,
        costCoveragePercent: delivered.length ? Math.round((costed.length / delivered.length) * 1000) / 10 : null,
        revenueOfCostedOrders: money(costedRevenue), supplierCostOfCostedOrders: money(cogs),
        grossProfitRecorded: costed.length ? money(grossProfit) : null,
        grossMarginPercent: costedRevenue > 0 ? Math.round((grossProfit / costedRevenue) * 1000) / 10 : null,
      },
      costs: {
        refunds: money(refundsCents), refundCount: refunds._count, courierSettlementFees: money(courierFees),
        operatingExpenses: money(expenseTotal),
        expensesByCategory: [...byCategory].map(([category, total]) => ({ category, total: money(total) })).sort((a, b) => b.total - a.total),
      },
      operatingResult: {
        value: result === null ? null : money(result),
        status: result === null ? 'INCOMPLETE' : 'RECORDED',
        missing,
        formula: 'goods revenue - supplier invoice cost + delivery fees - refunds - courier fees - recorded expenses',
      },
      estimates: {
        note: 'Configured per-order costs multiplied by delivered orders. Shown for planning; not part of any recorded total.',
        deliveryCost: deliveryCostUnit === null ? null : money(Math.round(deliveryCostUnit * 100) * delivered.length),
        packagingCost: packagingConfigured ? money((Math.round((cartonUnit ?? 0) * 100) + Math.round((labelUnit ?? 0) * 100)) * delivered.length) : null,
        perOrder: { delivery: deliveryCostUnit, carton: cartonUnit, label: labelUnit },
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
    const costByOrder = await this.costs.contributionForOrders(delivered.map(order => order.id));
    const weekly = range.days > 62;
    const bucketOf = (ymd: string) => weekly ? addDays(range.from, Math.floor(daysBetween(range.from, ymd) / 7) * 7) : ymd;
    const buckets = new Map<string, { date: string; revenue: number; orders: number; grossProfit: number; costedOrders: number; expenses: number; refunds: number; codSettled: number }>();
    const step = weekly ? 7 : 1;
    for (let offset = 0; offset < range.days; offset += step) {
      const date = addDays(range.from, offset);
      buckets.set(date, { date, revenue: 0, orders: 0, grossProfit: 0, costedOrders: 0, expenses: 0, refunds: 0, codSettled: 0 });
    }
    const at = (ymd: string) => buckets.get(bucketOf(ymd));
    for (const order of delivered) {
      const bucket = at(cairoYmd(order.deliveredAt));
      if (!bucket) continue;
      bucket.revenue += order.total; bucket.orders += 1;
      const cost = costByOrder.get(order.id);
      if (cost?.complete) { bucket.grossProfit += cents(cost.contribution); bucket.costedOrders += 1; }
    }
    for (const refund of refunds) { const b = at(cairoYmd(refund.updatedAt)); if (b) b.refunds += cents(refund.amount); }
    for (const batch of batches) { const b = at(cairoYmd(batch.settledAt)); if (b) b.codSettled += cents(batch.totalCollected); }
    for (const row of expenseRows) { const b = at(row.date); if (b) b.expenses += cents(row.amount); }
    return {
      currency: 'EGP', granularity: weekly ? 'week' : 'day',
      points: [...buckets.values()].map(bucket => ({
        date: bucket.date, orders: bucket.orders, costedOrders: bucket.costedOrders,
        revenue: money(bucket.revenue), grossProfit: money(bucket.grossProfit), expenses: money(bucket.expenses),
        refunds: money(bucket.refunds), codSettled: money(bucket.codSettled),
      })),
    };
  }

  /** Order-level breakdown of delivered orders: what the customer paid, the cash status and the supplier cost behind it. */
  async orders(range: ReportRange, page: { limit: number; offset: number }) {
    const all = (await this.deliveredOrders(range)).sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime());
    const slice = all.slice(page.offset, page.offset + page.limit);
    const costByOrder = await this.costs.contributionForOrders(slice.map(order => order.id));
    return {
      currency: 'EGP', total: all.length, limit: page.limit, offset: page.offset,
      items: slice.map(order => {
        const cost = costByOrder.get(order.id);
        const status = cost?.complete ? 'CAPTURED' : (cost?.pendingLines ?? 0) > 0 ? 'PENDING' : 'NOT_RECEIVED';
        const revenue = cost ? cents(cost.revenueOfReceived) : 0;
        return {
          orderId: order.id, orderNumber: order.orderNumber, deliveredAt: order.deliveredAt.toISOString(), paymentMethod: order.paymentMethod,
          goods: money(order.goods), discounts: money(order.discounts), deliveryFee: money(order.deliveryFee), total: money(order.total),
          cod: order.collection ? { status: order.collection.status, expected: money(order.collection.expected), collected: order.collection.collected === null ? null : money(order.collection.collected) } : null,
          cost: {
            status, supplierCost: cost?.complete ? money(cents(cost.actualCogs)) : null, contribution: cost?.complete ? money(cents(cost.contribution)) : null,
            marginPercent: cost?.complete && revenue > 0 ? Math.round((cents(cost.contribution) / revenue) * 1000) / 10 : null,
          },
        };
      }),
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
      ...expenseRows.map(row => ({ id: `expense:${row.expenseId}:${row.date}`, type: 'EXPENSE' as const, date: `${row.date}T00:00:00.000Z`, amount: -money(cents(row.amount)), reference: `${row.category} · ${row.description}`, orderId: null, basis: 'RECORDED' as const })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return { currency: 'EGP', total: rows.length, items: rows.slice(0, Math.min(options.limit, cap)) };
  }
}
