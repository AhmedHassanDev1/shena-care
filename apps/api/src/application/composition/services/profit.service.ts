import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SETTING_KEYS } from '../../../platform/settings/runtime-settings';
import { AcquisitionCostService, PurchaseCostService } from '../../../modules/sourcing/public';
import { FinanceExpenseService } from '../../../modules/operations/services/finance-expense.service';
import { SettingsService } from '../../../modules/operations/settings/settings.service';
import { addDays, cairoYmd, resolveRange, ReportRange } from './finance-dates';
import { readCashPosition } from '../../../platform/finance/cash-position';
import { quoteDeliveryEstimate } from './delivery-estimate';
import { computeProfit, EligibleOrder, EndedOrder, ProfitResult } from './profit-model';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** A collection in one of these states was counted by the hub: its cash reached the treasury. */
const SETTLED = ['settled', 'short', 'over'];
const cents = (value: Prisma.Decimal | number | null | undefined) => Math.round(Number(value ?? 0) * 100);
const money = (valueInCents: number) => valueInCents / 100;
const moneyOrNull = (valueInCents: number | null) => (valueInCents === null ? null : money(valueInCents));

export function monthRange(period: string, now = new Date()): ReportRange & { period: string; ended: boolean } {
  if (!MONTH.test(period)) throw new BadRequestException({ code: 'INVALID_PERIOD', message: 'Choose a month as YYYY-MM.' });
  const from = `${period}-01`;
  const [y, m] = period.split('-').map(Number);
  const nextFirst = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const range = resolveRange(from, addDays(nextFirst, -1), now);
  return { ...range, period, ended: cairoYmd(now) >= nextFirst };
}

export const currentPeriod = (now = new Date()) => cairoYmd(now).slice(0, 7);
export const previousPeriods = (count: number, now = new Date()): string[] => {
  const [y, m] = currentPeriod(now).split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const index = y * 12 + (m - 1) - (count - 1 - i);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
};

type Presented = ReturnType<ProfitService["presentFigures"]>;

/**
 * Monthly distributable profit, assembled from the records the platform already keeps and calculated by the pure model in `profit-model.ts`.
 * Reports only: closing a month freezes its figures and the percentage used; no money moves. The cash position (what couriers still hold,
 * what the hub counted) is computed separately and never feeds the profit.
 */
@Injectable()
export class ProfitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseCosts: PurchaseCostService,
    private readonly poCosts: AcquisitionCostService,
    private readonly expenses: FinanceExpenseService,
    private readonly settings: SettingsService,
  ) {}

  private configuredPercent(): number {
    return this.settings.effective<number>(SETTING_KEYS.profitSharePercent);
  }

  /** First event wins: an order belongs to the period it was first delivered (or first cancelled/returned). */
  private async firstEventOrders(statuses: string[], range: ReportRange) {
    const events = await this.prisma.orderStatusEvent.findMany({
      where: { status: { in: statuses as never[] }, createdAt: { gte: range.start, lt: range.end } },
      select: { orderId: true, createdAt: true }, orderBy: { createdAt: 'asc' },
    });
    const ids = [...new Set(events.map(event => event.orderId))];
    if (!ids.length) return [] as string[];
    const earlier = await this.prisma.orderStatusEvent.findMany({ where: { orderId: { in: ids }, status: { in: statuses as never[] }, createdAt: { lt: range.start } }, select: { orderId: true } });
    const seenBefore = new Set(earlier.map(event => event.orderId));
    return ids.filter(id => !seenBefore.has(id));
  }

  /** The cash position (see `readCashPosition`): shared by every report, never part of the profit. */
  cashPosition(range?: ReportRange) {
    return readCashPosition(this.prisma, range);
  }

  /** Every figure of a period. Public so the other reports read the same numbers instead of recomputing them. */
  async compute(range: ReportRange, percent: number) {
    const [deliveredIds, endedIds] = await Promise.all([this.firstEventOrders(['delivered'], range), this.firstEventOrders(['cancelled', 'returned'], range)]);
    const [delivered, ended, refunds, damageRows, expenseRows] = await Promise.all([
      deliveredIds.length ? this.prisma.order.findMany({
        where: { id: { in: deliveredIds }, status: 'delivered' },
        select: { id: true, orderNumber: true, paymentMethod: true, totalAmount: true, shippingFee: true,
          items: { where: { lineState: 'active' }, select: { id: true, quantity: true, price: true, discountAmount: true, lineTotal: true } },
          paymentCollection: { select: { status: true } }, checkoutQuote: { select: { snapshot: true } } },
      }) : [],
      endedIds.length ? this.prisma.order.findMany({
        where: { id: { in: endedIds }, status: { in: ['cancelled', 'returned'] } },
        select: { id: true, orderNumber: true, items: { select: { id: true } } },
      }) : [],
      this.prisma.refundTransaction.findMany({ where: { status: 'succeeded', updatedAt: { gte: range.start, lt: range.end } }, select: { amount: true, deliveryFeeAmount: true } }),
      this.prisma.orderCostRecord.findMany({ where: { damageConfirmedAt: { gte: range.start, lt: range.end }, damagedAmount: { not: null } }, select: { damagedAmount: true } }),
      this.expenses.occurrencesBetween(range.from, range.to),
    ]);
    const allItemIds = [...delivered.flatMap(order => order.items.map(item => item.id)), ...ended.flatMap(order => order.items.map(item => item.id))];
    const orderIds = [...delivered.map(order => order.id), ...ended.map(order => order.id)];
    const [buyCosts, poCosts, records, soundRows] = await Promise.all([
      this.purchaseCosts.costForOrderItems(allItemIds),
      this.poCosts.contributionForOrders(delivered.map(order => order.id)),
      this.prisma.orderCostRecord.findMany({ where: { orderId: { in: orderIds } } }),
      // Goods that came back sealed and intact return to stock: their cost is taken out of the cost of goods sold. Only the latest inspection counts.
      delivered.length ? this.prisma.returnReceipt.findMany({ where: { orderId: { in: delivered.map(order => order.id) }, inspectionResult: 'SEALED_INTACT', correction: null }, select: { orderItemId: true, quantity: true } }) : Promise.resolve([]),
    ]);
    const recordOf = new Map(records.map(record => [record.orderId, record]));
    const soundUnits = new Map<string, number>();
    for (const row of soundRows) soundUnits.set(row.orderItemId, (soundUnits.get(row.orderItemId) ?? 0) + row.quantity);

    const orders: EligibleOrder[] = delivered.map(order => {
      let gross = new Prisma.Decimal(0);
      let cogs: Prisma.Decimal | null = new Prisma.Decimal(0);
      for (const item of order.items) {
        gross = gross.plus(item.lineTotal ?? item.price.mul(item.quantity).minus(item.discountAmount ?? 0));
        const bought = buyCosts.get(item.id);
        if (cogs && bought && bought.units >= item.quantity && bought.costedUnits === bought.units) {
          let itemCost = bought.cost.mul(item.quantity).div(bought.units);
          const back = Math.min(soundUnits.get(item.id) ?? 0, item.quantity);
          if (back > 0) itemCost = itemCost.mul(item.quantity - back).div(item.quantity);
          cogs = cogs.plus(itemCost);
        } else cogs = null;
      }
      if (cogs === null || order.items.length === 0) {
        const po = poCosts.get(order.id);
        cogs = po?.complete && po.actualCogs !== null ? new Prisma.Decimal(po.actualCogs.toString()) : null;
      }
      const record = recordOf.get(order.id);
      const estimate = quoteDeliveryEstimate(order.checkoutQuote?.snapshot);
      const actual = record?.courierCost != null ? cents(record.courierCost) : null;
      return {
        orderId: order.id, orderNumber: order.orderNumber, grossGoods: cents(gross),
        // What the customer was billed for goods after every discount and coupon: the order total without the delivery fee.
        netGoods: Math.max(0, cents(order.totalAmount) - cents(order.shippingFee)), shippingRevenue: cents(order.shippingFee),
        cogs: cogs === null ? null : cents(cogs),
        courier: actual ?? (estimate === null ? null : cents(estimate)), courierEstimated: actual === null && estimate !== null,
        packaging: record?.packagingCost != null ? cents(record.packagingCost) : null,
        realised: order.paymentMethod !== 'COD' || (!!order.paymentCollection && SETTLED.includes(order.paymentCollection.status)),
      };
    });

    const endedOrders: EndedOrder[] = ended.map(order => {
      const record = recordOf.get(order.id);
      let bought = new Prisma.Decimal(0); let known = true;
      for (const item of order.items) {
        const entry = buyCosts.get(item.id);
        if (!entry) continue;
        if (entry.costedUnits < entry.units) known = false; else bought = bought.plus(entry.cost);
      }
      const damaged = record?.damagedAmount ?? new Prisma.Decimal(0);
      return {
        orderId: order.id, orderNumber: order.orderNumber, courier: cents(record?.courierCost), packaging: cents(record?.packagingCost),
        recoverableCost: known ? Math.max(0, cents(bought) - cents(damaged)) : null,
      };
    });

    const direct = expenseRows.filter(row => row.kind === 'DIRECT');
    const result = computeProfit({
      orders, ended: endedOrders,
      refunds: {
        goods: refunds.reduce((sum, refund) => sum + cents(refund.amount) - cents(refund.deliveryFeeAmount), 0),
        deliveryFee: refunds.reduce((sum, refund) => sum + cents(refund.deliveryFeeAmount), 0),
      },
      damages: damageRows.reduce((sum, row) => sum + cents(row.damagedAmount), 0),
      directCosts: direct.filter(row => row.approved).reduce((sum, row) => sum + cents(row.amount), 0),
      unapprovedDirect: new Set(direct.filter(row => !row.approved).map(row => row.expenseId)).size,
      platformExpenses: expenseRows.filter(row => row.kind !== 'DIRECT').reduce((sum, row) => sum + cents(row.amount), 0),
      platformPercent: percent,
    });

    const needsCost = orders.flatMap(order => {
      const missing = [order.cogs === null ? 'PURCHASE_COST' : null, order.courier === null ? 'COURIER_COST' : null, order.packaging === null ? 'PACKAGING_COST' : null].filter(Boolean) as string[];
      return missing.length ? [{ orderId: order.orderId, orderNumber: order.orderNumber, missing }] : [];
    }).slice(0, 25);
    return { result, needsCost, cash: await this.cashPosition(range) };
  }

  /** Cents to EGP for the response and for the frozen copy. */
  presentFigures(period: string, range: ReportRange, result: ProfitResult) {
    const r = result.revenue; const c = result.costs;
    return {
      period, range: { from: range.from, to: range.to }, currency: 'EGP', status: result.status, missing: result.missing, eligibleOrders: result.eligibleOrders,
      revenue: {
        grossSales: money(r.grossSales), discounts: money(r.discounts), netSales: money(r.netSales), productRefunds: money(r.productRefunds),
        netSalesAfterRefunds: money(r.netSalesAfterRefunds), shippingRevenue: money(r.shippingRevenue), deliveryFeeRefunds: money(r.deliveryFeeRefunds),
        shippingRevenueNet: money(r.shippingRevenueNet), total: money(r.total),
      },
      costs: { products: money(c.products), delivery: money(c.delivery), packaging: money(c.packaging), damages: money(c.damages), directCosts: money(c.directCosts), total: money(c.total) },
      delivery: { revenue: money(result.delivery.revenue), cost: money(result.delivery.cost), margin: money(result.delivery.margin), estimatedOrders: result.delivery.estimatedOrders, estimatedAmount: money(result.delivery.estimatedAmount) },
      grossProfit: moneyOrNull(result.grossProfit),
      distributableProfit: moneyOrNull(result.distributableProfit),
      realisedProfit: moneyOrNull(result.realisedProfit),
      pendingCollection: { orders: result.pendingCollection.orders, profit: moneyOrNull(result.pendingCollection.profit) },
      split: {
        platformPercent: result.split.platformPercent, platformShare: moneyOrNull(result.split.platformShare), partnerShare: moneyOrNull(result.split.partnerShare),
        platformShareNow: moneyOrNull(result.split.platformShareNow), partnerShareNow: moneyOrNull(result.split.partnerShareNow),
      },
      capital: { recovered: money(result.capital.recovered), tiedUpInUnsettledOrders: money(result.capital.tiedUpInUnsettledOrders), tiedUpInRecoverableGoods: money(result.capital.tiedUpInRecoverableGoods), recoverableUnknownOrders: result.capital.recoverableUnknownOrders },
      platformExpenses: money(result.platformExpenses),
    };
  }

  async month(period: string, now = new Date()) {
    const range = monthRange(period, now);
    const closed = await this.prisma.financePeriodClose.findUnique({ where: { period } });
    const percent = closed ? Number(closed.profitSharePercent) : this.configuredPercent();
    const { result, needsCost, cash } = await this.compute(range, percent);
    if (closed) {
      // A closed month shows exactly what was frozen; later cost entries, settlements or setting changes never rewrite it.
      return { ...(closed.figures as unknown as Presented), closed: { at: closed.closedAt, by: closed.closedBy }, liveStatus: result.status, needsCost: [], cash };
    }
    return { ...this.presentFigures(period, range, result), closed: null, needsCost, cash, monthEnded: range.ended };
  }

  /** Compact per-month figures for the trend chart, oldest first. Closed months read their frozen numbers (older frozen months keep their earlier shape). */
  async trend(months: number, now = new Date()) {
    const periods = previousPeriods(months, now);
    const closed = new Map((await this.prisma.financePeriodClose.findMany({ where: { period: { in: periods } } })).map(row => [row.period, row]));
    const points = [];
    for (const period of periods) {
      const frozen = closed.get(period);
      const range = monthRange(period, now);
      const figures = (frozen ? frozen.figures : this.presentFigures(period, range, (await this.compute(range, this.configuredPercent())).result)) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a frozen month may carry an older shape
      const legacy = figures.distributableProfit === undefined;
      points.push({
        period, status: figures.status, closed: !!frozen,
        revenue: legacy ? figures.revenue.net : figures.revenue.total, costs: figures.costs.total,
        distributableProfit: legacy ? figures.netProfit : figures.distributableProfit,
        platformShare: legacy ? figures.profitShare : figures.split.platformShare,
      });
    }
    return { currency: 'EGP', points };
  }

  /** Freezes a finished, fully costed and fully collected month with the percentage in force. Repeating the call returns the frozen record. */
  async close(period: string, actorId: string, now = new Date()) {
    const range = monthRange(period, now);
    const existing = await this.prisma.financePeriodClose.findUnique({ where: { period } });
    if (existing) return { alreadyClosed: true, ...(await this.month(period, now)) };
    if (!range.ended) throw new ConflictException({ code: 'PERIOD_NOT_ENDED', message: 'A month can be closed only after it has ended' });
    const percent = this.configuredPercent();
    const { result } = await this.compute(range, percent);
    if (result.status !== 'COMPLETE' || result.distributableProfit === null || result.split.platformShare === null) {
      throw new ConflictException({ code: 'PERIOD_INCOMPLETE', message: 'Record the missing actual costs and approve the direct costs before closing this month', missing: result.missing });
    }
    if (result.pendingCollection.orders > 0) {
      throw new ConflictException({ code: 'PERIOD_CASH_PENDING', message: 'Delivered orders of this month still have cash with the courier; count and settle it before closing, so the distribution follows real cash', pendingOrders: result.pendingCollection.orders });
    }
    const figures = this.presentFigures(period, range, result);
    try {
      await this.prisma.financePeriodClose.create({ data: {
        period, profitSharePercent: percent, netProfit: result.distributableProfit / 100, profitShareAmount: result.split.platformShare / 100,
        figures: figures as unknown as Prisma.InputJsonValue, closedBy: actorId,
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
    return { alreadyClosed: false, ...(await this.month(period, now)) };
  }

  async requireClosed(period: string) {
    const row = await this.prisma.financePeriodClose.findUnique({ where: { period } });
    if (!row) throw new NotFoundException('This month is not closed');
    return row;
  }
}
