import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { SETTING_KEYS } from '../../../platform/settings/runtime-settings';
import { AcquisitionCostService, PurchaseCostService } from '../../../modules/sourcing/public';
import { FinanceExpenseService } from '../../../modules/operations/services/finance-expense.service';
import { SettingsService } from '../../../modules/operations/settings/settings.service';
import { addDays, cairoYmd, resolveRange, ReportRange } from './finance-dates';
import { computeProfit, EligibleOrder, LostOrder, ProfitResult } from './profit-model';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SETTLED = ['settled', 'short', 'over'];
const cents = (value: Prisma.Decimal | number | null | undefined) => Math.round(Number(value ?? 0) * 100);
const money = (valueInCents: number) => valueInCents / 100;

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

type Presented = ReturnType<ProfitService['present']>;

/**
 * Monthly profit and profit share, assembled from the records the platform already keeps (delivered orders, Buy List purchase costs,
 * per-order courier/packaging cost, refunds, recorded expenses) and calculated by the pure model in `profit-model.ts`. Reports only:
 * closing a month freezes its numbers and the percentage used; no money is moved.
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

  /** First event wins: an order belongs to the month it was first delivered (or first cancelled/returned). */
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

  private async live(range: ReportRange, percent: number) {
    const [deliveredIds, endedIds] = await Promise.all([this.firstEventOrders(['delivered'], range), this.firstEventOrders(['cancelled', 'returned'], range)]);
    const [delivered, ended, refunds, expenseRows] = await Promise.all([
      deliveredIds.length ? this.prisma.order.findMany({
        where: { id: { in: deliveredIds }, status: 'delivered' },
        select: { id: true, orderNumber: true, paymentMethod: true, shippingFee: true,
          items: { where: { lineState: 'active' }, select: { id: true, quantity: true, price: true, discountAmount: true, lineTotal: true } },
          paymentCollection: { select: { status: true, expectedAmount: true, collectedAmount: true } } },
      }) : [],
      endedIds.length ? this.prisma.order.findMany({
        where: { id: { in: endedIds }, status: { in: ['cancelled', 'returned'] } },
        select: { id: true, orderNumber: true, items: { select: { id: true } } },
      }) : [],
      this.prisma.refundTransaction.findMany({ where: { status: 'succeeded', updatedAt: { gte: range.start, lt: range.end }, order: { status: 'delivered' } }, select: { amount: true } }),
      this.expenses.occurrencesBetween(range.from, range.to),
    ]);
    const allItemIds = [...delivered.flatMap(order => order.items.map(item => item.id)), ...ended.flatMap(order => order.items.map(item => item.id))];
    const [buyCosts, poCosts, records] = await Promise.all([
      this.purchaseCosts.costForOrderItems(allItemIds),
      this.poCosts.contributionForOrders(delivered.map(order => order.id)),
      this.prisma.orderCostRecord.findMany({ where: { orderId: { in: [...delivered.map(o => o.id), ...ended.map(o => o.id)] } } }),
    ]);
    const recordOf = new Map(records.map(record => [record.orderId, record]));

    const orders: EligibleOrder[] = delivered.map(order => {
      let goods = new Prisma.Decimal(0);
      let cogs: Prisma.Decimal | null = new Prisma.Decimal(0);
      for (const item of order.items) {
        goods = goods.plus(item.lineTotal ?? item.price.mul(item.quantity).minus(item.discountAmount ?? 0));
        const bought = buyCosts.get(item.id);
        if (cogs && bought && bought.units >= item.quantity && bought.costedUnits === bought.units) cogs = cogs.plus(bought.cost.mul(item.quantity).div(bought.units));
        else cogs = null;
      }
      if (cogs === null || order.items.length === 0) {
        const po = poCosts.get(order.id);
        cogs = po?.complete && po.actualCogs !== null ? new Prisma.Decimal(po.actualCogs.toString()) : null;
      }
      const record = recordOf.get(order.id);
      return {
        orderId: order.id, orderNumber: order.orderNumber, goodsNet: cents(goods), customerDeliveryFee: cents(order.shippingFee),
        cogs: cogs === null ? null : cents(cogs), courierCost: record?.courierCost ? cents(record.courierCost) : null, packagingCost: record?.packagingCost ? cents(record.packagingCost) : null,
      };
    });

    const losses: LostOrder[] = ended.map(order => {
      let purchase: Prisma.Decimal | null = new Prisma.Decimal(0);
      for (const item of order.items) {
        const bought = buyCosts.get(item.id);
        if (!bought) continue;
        if (bought.costedUnits < bought.units) purchase = null; else if (purchase) purchase = purchase.plus(bought.cost);
      }
      const record = recordOf.get(order.id);
      return { orderId: order.id, orderNumber: order.orderNumber, purchaseCost: purchase === null ? null : cents(purchase), courierCost: cents(record?.courierCost), packagingCost: cents(record?.packagingCost) };
    }).filter(loss => loss.purchaseCost === null || loss.purchaseCost + loss.courierCost + loss.packagingCost > 0);

    const result = computeProfit({
      orders, losses, refunds: refunds.reduce((sum, refund) => sum + cents(refund.amount), 0),
      operatingExpenses: expenseRows.reduce((sum, row) => sum + cents(row.amount), 0), profitSharePercent: percent,
    });

    const needsCost = orders.flatMap(order => {
      const missing = [order.cogs === null ? 'PURCHASE_COST' : null, order.courierCost === null ? 'COURIER_COST' : null, order.packagingCost === null ? 'PACKAGING_COST' : null].filter(Boolean) as string[];
      return missing.length ? [{ orderId: order.orderId, orderNumber: order.orderNumber, missing }] : [];
    }).slice(0, 25);

    // COD is cash, not profit: kept separate and always read live.
    const cod = delivered.filter(order => order.paymentMethod === 'COD' && order.paymentCollection && order.paymentCollection.status !== 'voided');
    const sum = (filter: (status: string) => boolean, pick: (c: NonNullable<(typeof cod)[number]['paymentCollection']>) => number) =>
      cod.filter(order => filter(order.paymentCollection!.status)).reduce((total, order) => total + pick(order.paymentCollection!), 0);
    const expected = (c: { expectedAmount: Prisma.Decimal }) => cents(c.expectedAmount);
    return {
      result, needsCost,
      cod: {
        orders: cod.length,
        expected: money(sum(() => true, expected)),
        notYetCollected: money(sum(status => status === 'expected', expected)),
        collectedByDrivers: money(sum(status => status === 'collected', expected)),
        disputed: money(sum(status => status === 'disputed', expected)),
        outstanding: money(sum(status => ['expected', 'collected', 'disputed'].includes(status), expected)),
        settled: money(sum(status => SETTLED.includes(status), c => cents(c.collectedAmount))),
      },
    };
  }

  /** Cents to EGP for the response and for the frozen copy. */
  private present(period: string, range: ReportRange, result: ProfitResult) {
    return {
      period, range: { from: range.from, to: range.to }, currency: 'EGP', status: result.status, missing: result.missing, eligibleOrders: result.eligibleOrders,
      revenue: { productSales: money(result.productSales), refunds: money(result.refunds), net: money(result.revenue) },
      costs: {
        purchase: money(result.costs.purchase), companyFundedDelivery: money(result.costs.companyFundedDelivery), packaging: money(result.costs.packaging),
        losses: money(result.costs.losses), operatingExpenses: money(result.costs.operatingExpenses), total: money(result.costs.total),
      },
      delivery: { customerFees: money(result.delivery.customerFees), courierCost: money(result.delivery.courierCost), companyFunded: money(result.delivery.companyFunded), customerSurplus: money(result.delivery.customerSurplus) },
      netProfit: result.netProfit === null ? null : money(result.netProfit),
      profitSharePercent: result.profitSharePercent,
      profitShare: result.profitShare === null ? null : money(result.profitShare),
    };
  }

  async month(period: string, now = new Date()) {
    const range = monthRange(period, now);
    const closed = await this.prisma.financePeriodClose.findUnique({ where: { period } });
    const percent = closed ? Number(closed.profitSharePercent) : this.configuredPercent();
    const { result, needsCost, cod } = await this.live(range, percent);
    if (closed) {
      // A closed month shows exactly what was frozen; later cost entries or setting changes never rewrite it.
      return { ...(closed.figures as unknown as Presented), closed: { at: closed.closedAt, by: closed.closedBy }, liveStatus: result.status, needsCost: [], cod };
    }
    return { ...this.present(period, range, result), closed: null, needsCost, cod, monthEnded: range.ended };
  }

  /** Compact per-month figures for the trend chart, oldest first. Closed months read their frozen numbers. */
  async trend(months: number, now = new Date()) {
    const periods = previousPeriods(months, now);
    const closed = new Map((await this.prisma.financePeriodClose.findMany({ where: { period: { in: periods } } })).map(row => [row.period, row]));
    const points = [];
    for (const period of periods) {
      const frozen = closed.get(period);
      const figures = frozen ? (frozen.figures as unknown as Presented) : this.present(period, monthRange(period, now), (await this.live(monthRange(period, now), this.configuredPercent())).result);
      points.push({ period, status: figures.status, closed: !!frozen, revenue: figures.revenue.net, costs: figures.costs.total, netProfit: figures.netProfit, profitShare: figures.profitShare });
    }
    return { currency: 'EGP', points };
  }

  /** Freezes a finished, fully costed month together with the percentage in force. Repeating the call returns the frozen record. */
  async close(period: string, actorId: string, now = new Date()) {
    const range = monthRange(period, now);
    const existing = await this.prisma.financePeriodClose.findUnique({ where: { period } });
    if (existing) return { alreadyClosed: true, ...(await this.month(period, now)) };
    if (!range.ended) throw new ConflictException({ code: 'PERIOD_NOT_ENDED', message: 'A month can be closed only after it has ended' });
    const percent = this.configuredPercent();
    const { result } = await this.live(range, percent);
    if (result.status !== 'COMPLETE' || result.netProfit === null || result.profitShare === null) {
      throw new ConflictException({ code: 'PERIOD_INCOMPLETE', message: 'Record the missing actual costs before closing this month', missing: result.missing });
    }
    const figures = this.present(period, range, result);
    try {
      await this.prisma.financePeriodClose.create({ data: {
        period, profitSharePercent: percent, netProfit: result.netProfit / 100, profitShareAmount: result.profitShare / 100,
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
