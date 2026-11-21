import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { cairoYmd, resolveRange } from './finance-dates';
import { monthRange, ProfitService, previousPeriods } from './profit.service';
import { CapitalPartnerMovementsService, FUNDED_TYPES, MOVEMENT_TYPES, Movement, MovementType, windowOf } from './capital-partner-movements.service';
import {
  MonthFigures, SettlementState, money, moneyOrNull, normaliseFigures, partnerPercent, payoutRoom, remainingShare, settlementState, unresolvedGoods,
} from './capital-partner-model';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 12;
const MAX_LIFETIME_MONTHS = 36;
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);

const shiftMonth = (period: string, delta: number) => {
  const [y, m] = period.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};
const monthsBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let period = from; period <= to && out.length <= 120; period = shiftMonth(period, 1)) out.push(period);
  return out;
};
const lastDayOf = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

export type EntryKind = 'CAPITAL_RETURN' | 'PROFIT_PAYOUT';

/**
 * The capital partner's finance, read from the SAME figures the Admin Finance page uses (`ProfitService`, frozen at month close) plus what
 * Admin recorded as actually paid to the partner. The partner can only read, and only their own profile (the profile is found from the signed-in
 * account, never from an id in the request). Admin writes (designating the partner, recording / voiding a payment) are guarded in the controller.
 */
@Injectable()
export class CapitalPartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profit: ProfitService,
    private readonly movements: CapitalPartnerMovementsService,
  ) {}

  // ------------------------------------------------------------------------------------------------------------------ profile
  /** The partner profile of the signed-in account. An account without an ACTIVE profile (or a deactivated one) sees nothing. */
  async requirePartner(accountId: string) {
    const partner = await this.prisma.capitalPartner.findFirst({ where: { accountId, isActive: true } });
    if (!partner) throw new ForbiddenException({ code: 'NOT_A_CAPITAL_PARTNER', message: 'This account is not the capital partner.' });
    return partner;
  }

  async me(accountId: string) {
    const partner = await this.requirePartner(accountId);
    const platform = this.profit.currentPercent();
    return { displayName: partner.displayName, since: partner.createdAt.toISOString(), currency: 'EGP', split: { platformPercent: platform, partnerPercent: partnerPercent(platform) } };
  }

  // ---------------------------------------------------------------------------------------------------------------- helpers
  private async figures(period: string): Promise<{ figures: MonthFigures; closed: { at: Date } | null; monthEnded: boolean }> {
    const result = await this.profit.figuresFor(period);
    return { figures: normaliseFigures(result.figures as unknown as Record<string, unknown>), closed: result.closed, monthEnded: result.monthEnded };
  }

  private async mapLimited<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(run)));
    return out;
  }

  /** Profit payouts recorded per profit month (voided entries never count). */
  private async paidByPeriod(partnerId: string, periods: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.capitalPartnerEntry.groupBy({
      by: ['period'], where: { partnerId, kind: 'PROFIT_PAYOUT', voidedAt: null, period: { in: periods } }, _sum: { amount: true },
    });
    return new Map(rows.map(row => [row.period as string, cents(row._sum.amount)]));
  }

  private async capitalReturnedBetween(partnerId: string, from: string, to: string): Promise<number> {
    const row = await this.prisma.capitalPartnerEntry.aggregate({
      where: { partnerId, kind: 'CAPITAL_RETURN', voidedAt: null, paidOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, _sum: { amount: true },
    });
    return cents(row._sum.amount);
  }

  /** First month any funding or sales activity exists (Cairo), or null for an empty system. */
  private async firstActivityMonth(): Promise<string | null> {
    const [batch, lot, order, expense, event] = await Promise.all([
      this.prisma.purchaseCostBatch.aggregate({ _min: { recordedAt: true } }),
      this.prisma.acquisitionCostLot.aggregate({ _min: { capturedAt: true } }),
      this.prisma.orderCostRecord.aggregate({ _min: { courierRecordedAt: true, packagingRecordedAt: true } }),
      this.prisma.financeExpense.aggregate({ where: { kind: 'DIRECT' }, _min: { incurredOn: true } }),
      this.prisma.orderStatusEvent.aggregate({ where: { status: 'delivered' }, _min: { createdAt: true } }),
    ]);
    const now = new Date();
    const dates = [batch._min.recordedAt, lot._min.capturedAt, order._min.courierRecordedAt, order._min.packagingRecordedAt, expense._min.incurredOn, event._min.createdAt]
      .filter((date): date is Date => !!date && date <= now);
    if (!dates.length) return null;
    return cairoYmd(new Date(Math.min(...dates.map(date => date.getTime())))).slice(0, 7);
  }

  /** What the partner funded and was paid back since the business began: the balance that does not depend on any filter. */
  async lifetimeBalances(partnerId: string) {
    const current = cairoYmd(new Date()).slice(0, 7);
    const first = await this.firstActivityMonth();
    const earliestAllowed = shiftMonth(current, -(MAX_LIFETIME_MONTHS - 1));
    const since = first === null ? null : first < earliestAllowed ? earliestAllowed : first;
    const truncated = first !== null && first < earliestAllowed;
    const funded = since === null ? 0 : (await this.movements.load(partnerId, windowOf(`${since}-01`, cairoYmd(new Date())), FUNDED_TYPES)).filter(m => m.effect === 'FUNDED').reduce((s, m) => s + cents(m.amount), 0);
    const returned = cents((await this.prisma.capitalPartnerEntry.aggregate({ where: { partnerId, kind: 'CAPITAL_RETURN', voidedAt: null }, _sum: { amount: true } }))._sum.amount);
    return { since, truncated, funded, returned, outstanding: Math.max(0, funded - returned), months: since === null ? [] : monthsBetween(since, current) };
  }

  // ----------------------------------------------------------------------------------------------------------------- statements
  private presentStatement(period: string, source: { figures: MonthFigures; closed: { at: Date } | null; monthEnded: boolean }, paid: number, capitalReturnedInMonth: number) {
    const f = source.figures;
    const state: SettlementState = settlementState(f, paid);
    return {
      period, currency: 'EGP', status: f.status, settlement: state, closed: source.closed ? { at: source.closed.at.toISOString() } : null, monthEnded: source.monthEnded, legacyShape: f.legacy,
      missing: f.missing, deliveredOrders: f.eligibleOrders,
      sales: {
        grossSales: money(f.grossSales), discounts: money(f.discounts), netSales: money(f.netSales), productRefunds: money(f.productRefunds),
        netSalesAfterRefunds: money(f.netSales - f.productRefunds), deliveryRevenue: money(f.shippingRevenue - f.deliveryFeeRefunds),
      },
      costs: { products: money(f.products), delivery: money(f.delivery), packaging: money(f.packaging), confirmedDamages: money(f.damages), directCosts: money(f.directCosts), total: money(f.products + f.delivery + f.packaging + f.damages + f.directCosts) },
      distributableProfit: moneyOrNull(f.distributable),
      split: { platformPercent: f.platformPercent, platformShare: moneyOrNull(f.platformShare), partnerPercent: partnerPercent(f.platformPercent), partnerShare: moneyOrNull(f.partnerShare), partnerShareNow: moneyOrNull(f.partnerShareNow) },
      profitPayout: { paid: money(paid), remaining: moneyOrNull(remainingShare(f, paid)), payableNow: f.status === 'COMPLETE' ? money(payoutRoom(f, paid)) : null },
      capital: {
        recoveredFromSettledOrders: money(f.capitalRecovered), tiedUpInUnsettledOrders: money(f.capitalTiedUpUnsettled), tiedUpInRecoverableGoods: money(f.capitalRecoverableGoods), returnedToPartnerInMonth: money(capitalReturnedInMonth),
      },
      pendingCollection: { orders: f.pendingCollectionOrders },
    };
  }

  private async statementFor(partnerId: string, period: string) {
    const [source, paid] = await Promise.all([this.figures(period), this.paidByPeriod(partnerId, [period])]);
    const range = monthRange(period);
    return { source, paid: paid.get(period) ?? 0, capitalReturned: await this.capitalReturnedBetween(partnerId, range.from, range.to) };
  }

  private assertPeriod(period: string) {
    if (!PERIOD.test(period)) throw new BadRequestException({ code: 'INVALID_PERIOD', message: 'Choose a month as YYYY-MM.' });
    if (period > cairoYmd(new Date()).slice(0, 7)) throw new BadRequestException({ code: 'PERIOD_IN_FUTURE', message: 'That month has not started.' });
  }

  private resolveMonths(from?: string, to?: string, defaultCount = 3): string[] {
    const current = cairoYmd(new Date()).slice(0, 7);
    const end = to ?? current;
    const start = from ?? shiftMonth(end, -(defaultCount - 1));
    for (const value of [start, end]) this.assertPeriod(value);
    if (end < start) throw new BadRequestException({ code: 'INVALID_PERIOD_RANGE', message: 'The last month is before the first month.' });
    const months = monthsBetween(start, end);
    if (months.length > MAX_MONTHS) throw new BadRequestException({ code: 'PERIOD_RANGE_TOO_LONG', message: `Choose at most ${MAX_MONTHS} months.` });
    return months;
  }

  /** The monthly statements of a range (newest first) with everything the profits & settlements page shows per month. */
  async statements(accountId: string, from?: string, to?: string) {
    const partner = await this.requirePartner(accountId);
    const months = this.resolveMonths(from, to, 6);
    const rows = await this.mapLimited(months, 4, period => this.statementFor(partner.id, period).then(row => this.presentStatement(period, row.source, row.paid, row.capitalReturned)));
    return { currency: 'EGP', range: { from: months[0], to: months[months.length - 1] }, months: rows.reverse() };
  }

  /** One month with the orders and movements that formed its numbers. Order rows carry the order number only: no customer data. */
  async statement(accountId: string, period: string) {
    const partner = await this.requirePartner(accountId);
    this.assertPeriod(period);
    const row = await this.statementFor(partner.id, period);
    const range = monthRange(period);
    const percent = row.source.closed ? row.source.figures.platformPercent : this.profit.currentPercent();
    const { detail } = await this.profit.compute(range, percent);
    const [deliveredAt, endedAt] = await Promise.all([this.profit.firstEventDates(['delivered'], range), this.profit.firstEventDates(['cancelled', 'returned'], range)]);
    const orders = detail.orders.slice(0, 500).map(order => {
      const known = order.cogs !== null && order.courier !== null && order.packaging !== null;
      return {
        orderNumber: order.orderNumber, deliveredAt: (deliveredAt.get(order.orderId) ?? range.start).toISOString(),
        grossGoods: money(order.grossGoods), discounts: money(Math.max(0, order.grossGoods - order.netGoods)), netGoods: money(order.netGoods), deliveryRevenue: money(order.shippingRevenue),
        productCost: moneyOrNull(order.cogs), deliveryCost: moneyOrNull(order.courier), deliveryCostEstimated: order.courierEstimated, packaging: moneyOrNull(order.packaging),
        profit: known ? money(order.netGoods + order.shippingRevenue - order.cogs! - order.courier! - order.packaging!) : null,
        cash: order.realised ? 'SETTLED' : 'PENDING',
      };
    });
    const ended = detail.ended.slice(0, 500).map(order => ({
      orderNumber: order.orderNumber, endedAt: (endedAt.get(order.orderId) ?? range.start).toISOString(), deliveryCost: money(order.courier), packaging: money(order.packaging),
      recoverableGoods: moneyOrNull(order.recoverableCost),
    }));
    return {
      ...this.presentStatement(period, row.source, row.paid, row.capitalReturned),
      range: { from: range.from, to: range.to },
      /** Closed months freeze their figures; the order list is read live and may differ only if costs were corrected after the close. */
      detailBasis: row.source.closed ? 'LIVE_ORDERS_FROZEN_FIGURES' : 'LIVE',
      orders, endedOrders: ended,
      payouts: (await this.prisma.capitalPartnerEntry.findMany({ where: { partnerId: partner.id, kind: 'PROFIT_PAYOUT', period }, orderBy: { paidOn: 'asc' } }))
        .map(entry => ({ id: `profit-payout:${entry.id}`, paidOn: entry.paidOn.toISOString().slice(0, 10), amount: Number(entry.amount), reference: entry.reference, voided: !!entry.voidedAt })),
    };
  }

  // ------------------------------------------------------------------------------------------------------------------ overview
  async overview(accountId: string, from?: string, to?: string) {
    const partner = await this.requirePartner(accountId);
    const months = this.resolveMonths(from, to, 3);
    const first = months[0]; const last = months[months.length - 1];
    const window = windowOf(`${first}-01`, lastDayOf(last) > cairoYmd(new Date()) ? cairoYmd(new Date()) : lastDayOf(last));

    const lifetime = await this.lifetimeBalances(partner.id);
    const allMonths = [...new Set([...lifetime.months, ...months])].sort();
    const [byMonth, paid, rows] = await Promise.all([
      this.mapLimited(allMonths, 4, async period => [period, await this.figures(period)] as const).then(list => new Map(list)),
      this.paidByPeriod(partner.id, allMonths),
      this.movements.load(partner.id, window, MOVEMENT_TYPES.filter(type => type !== 'CANCELLED_ORDER')),
    ]);

    // Funding, from the very movements page 2 lists.
    const funded = rows.filter(m => m.effect === 'FUNDED');
    const sum = (types: MovementType[]) => funded.filter(m => types.includes(m.type)).reduce((s, m) => s + cents(m.amount), 0);
    const products = sum(['PURCHASE']); const delivery = sum(['DELIVERY_COST']); const packaging = sum(['PACKAGING_COST']); const approvedExpenses = sum(['DIRECT_EXPENSE']);
    const pending = rows.filter(m => m.type === 'DIRECT_EXPENSE' && m.status === 'PENDING_APPROVAL');
    const returnedInRange = cents((await this.prisma.capitalPartnerEntry.aggregate({
      where: { partnerId: partner.id, kind: 'CAPITAL_RETURN', voidedAt: null, paidOn: { gte: new Date(`${window.from}T00:00:00Z`), lte: new Date(`${window.to}T00:00:00Z`) } }, _sum: { amount: true },
    }))._sum.amount);

    // Profit, month by month, summed only over COMPLETE months: an incomplete month is named, never estimated.
    const monthRows = months.map(period => {
      const source = byMonth.get(period)!;
      return { period, source, paid: paid.get(period) ?? 0 };
    });
    const complete = monthRows.filter(row => row.source.figures.status === 'COMPLETE' && row.source.figures.distributable !== null);
    const sumOf = (pick: (f: MonthFigures) => number | null) => complete.reduce((s, row) => s + (pick(row.source.figures) ?? 0), 0);
    const accrued = sumOf(f => f.partnerShare);
    const paidTotal = monthRows.reduce((s, row) => s + row.paid, 0);
    const remaining = complete.reduce((s, row) => s + (remainingShare(row.source.figures, row.paid) ?? 0), 0);
    const payableNow = complete.reduce((s, row) => s + payoutRoom(row.source.figures, row.paid), 0);

    const lifetimeFigures = lifetime.months.map(period => byMonth.get(period)!.figures);
    const goods = lifetime.since === null || lifetime.truncated ? null : unresolvedGoods({ purchases: lifetime.funded === 0 ? 0 : await this.lifetimeProducts(partner.id, lifetime.since), months: lifetimeFigures });
    const cash = await this.profit.cashPosition({ ...window, days: 0 });

    return {
      currency: 'EGP', range: { from: first, to: last, months: months.length },
      split: { platformPercent: this.profit.currentPercent(), partnerPercent: partnerPercent(this.profit.currentPercent()) },
      capital: {
        funded: { total: money(products + delivery + packaging + approvedExpenses), products: money(products), directCosts: { total: money(delivery + packaging + approvedExpenses), delivery: money(delivery), packaging: money(packaging), approvedExpenses: money(approvedExpenses) } },
        returned: money(returnedInRange),
        notReturnedYet: money(Math.max(0, lifetime.funded - lifetime.returned)),
        recoveredFromSettledOrders: money(complete.reduce((s, row) => s + row.source.figures.capitalRecovered, 0)),
        pendingApprovalDirectCosts: { amount: money(pending.reduce((s, m) => s + cents(m.amount), 0)), count: pending.length },
        lifetime: { since: lifetime.since, truncated: lifetime.truncated, funded: money(lifetime.funded), returned: money(lifetime.returned), outstanding: money(lifetime.outstanding) },
        unresolvedGoods: goods === null
          ? { status: lifetime.truncated ? 'NO_DATA' : 'INCOMPLETE', amount: null, note: 'Shown only when every sold order has its purchase cost recorded.' }
          : { status: 'AVAILABLE', amount: money(goods), note: 'Purchased goods not yet sold, damaged or confirmed lost (in stock, in transit or recoverable).' },
      },
      profit: {
        status: complete.length === monthRows.length ? 'COMPLETE' : 'INCOMPLETE', incompleteMonths: monthRows.filter(row => !complete.includes(row)).map(row => row.period),
        distributableProfit: complete.length ? money(sumOf(f => f.distributable)) : null, platformShare: complete.length ? money(sumOf(f => f.platformShare)) : null,
        partnerShare: complete.length ? money(accrued) : null, paid: money(paidTotal), remaining: complete.length ? money(remaining) : null, payableNow: money(payableNow),
      },
      cash: { expectedOnRoad: cash.expectedOnRoad, inCourierCustody: cash.inCourierCustody, disputed: cash.disputed, settlements: cash.settlements ?? null },
      months: monthRows.map(row => this.presentStatement(row.period, row.source, row.paid, 0)).reverse().map(statement => ({
        period: statement.period, status: statement.status, settlement: statement.settlement, closed: !!statement.closed, monthEnded: statement.monthEnded,
        distributableProfit: statement.distributableProfit, partnerShare: statement.split.partnerShare, paid: statement.profitPayout.paid, remaining: statement.profitPayout.remaining,
      })),
      recent: rows.slice(0, 10),
    };
  }

  /** Purchases (products only) since `since`, for the unresolved-goods balance. */
  private async lifetimeProducts(partnerId: string, since: string): Promise<number> {
    return (await this.movements.load(partnerId, windowOf(`${since}-01`, cairoYmd(new Date())), ['PURCHASE'])).reduce((s, m) => s + cents(m.amount), 0);
  }

  // ---------------------------------------------------------------------------------------------------------------- movements
  async listMovements(accountId: string, query: { from?: string; to?: string; type?: string; status?: string; q?: string; limit: number; offset: number }) {
    const partner = await this.requirePartner(accountId);
    const to = query.to ?? cairoYmd(new Date());
    const from = query.from ?? `${shiftMonth(to.slice(0, 7), -2)}-01`;
    const range = resolveRange(from, to);
    const types = query.type ? MOVEMENT_TYPES.filter(type => type === query.type) : MOVEMENT_TYPES;
    if (query.type && !types.length) throw new BadRequestException({ code: 'INVALID_TYPE', message: `type must be one of ${MOVEMENT_TYPES.join(', ')}` });
    let rows = await this.movements.load(partner.id, windowOf(range.from, range.to), types);
    if (query.status) rows = rows.filter(row => row.status === query.status);
    const needle = query.q?.trim().toLowerCase();
    if (needle) rows = rows.filter(row => [row.id, row.reference, row.orderNumber ?? '', row.type, row.status].some(text => text.toLowerCase().includes(needle)));
    const total = (types: MovementType[], effect: Movement['effect']) => money(rows.filter(row => row.effect === effect && types.includes(row.type)).reduce((s, row) => s + cents(row.amount), 0));
    return {
      currency: 'EGP', range: { from: range.from, to: range.to }, total: rows.length, limit: query.limit, offset: query.offset,
      // Capital returned and profit paid are separate totals: they are never added together.
      totals: { funded: total(FUNDED_TYPES, 'FUNDED'), capitalReturned: total(['CAPITAL_RETURN'], 'RETURNED'), profitPaid: total(['PROFIT_PAYOUT'], 'RETURNED') },
      items: rows.slice(query.offset, query.offset + query.limit),
    };
  }

  async movementDetail(accountId: string, id: string) {
    const partner = await this.requirePartner(accountId);
    return this.movements.detail(partner.id, id);
  }

  // =============================================================================================================== Admin side
  async adminProfile() {
    const partner = await this.prisma.capitalPartner.findFirst({ where: { isActive: true } });
    if (!partner) return { partner: null };
    const account = await this.prisma.customer.findUnique({ where: { id: partner.accountId }, select: { name: true, email: true, isActive: true } });
    const lifetime = await this.lifetimeBalances(partner.id);
    const periods = previousPeriods(6);
    const [byMonth, paid] = await Promise.all([this.mapLimited(periods, 3, async period => [period, await this.figures(period)] as const).then(list => new Map(list)), this.paidByPeriod(partner.id, periods)]);
    return {
      partner: { id: partner.id, displayName: partner.displayName, accountId: partner.accountId, accountName: account?.name ?? null, accountEmail: account?.email ?? null, accountActive: account?.isActive ?? false, since: partner.createdAt.toISOString() },
      balances: { currency: 'EGP', since: lifetime.since, truncated: lifetime.truncated, funded: money(lifetime.funded), returned: money(lifetime.returned), outstanding: money(lifetime.outstanding) },
      months: periods.map(period => {
        const f = byMonth.get(period)!.figures; const p = paid.get(period) ?? 0;
        return { period, status: f.status, settlement: settlementState(f, p), partnerShare: moneyOrNull(f.partnerShare), paid: money(p), payableNow: f.status === 'COMPLETE' ? money(payoutRoom(f, p)) : null };
      }).reverse(),
    };
  }

  async designate(dto: { accountId: string; displayName: string }, actorId: string) {
    const account = await this.prisma.customer.findUnique({ where: { id: dto.accountId }, select: { id: true, isActive: true, roles: true } });
    if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'No such account' });
    if (!account.isActive) throw new BadRequestException({ code: 'ACCOUNT_INACTIVE', message: 'The account is deactivated.' });
    if (!account.roles.includes('CAPITAL_PARTNER')) throw new BadRequestException({ code: 'ROLE_REQUIRED', message: 'Give the account the CAPITAL_PARTNER role first.' });
    if (account.roles.includes('ADMIN')) throw new BadRequestException({ code: 'ADMIN_CANNOT_BE_PARTNER', message: 'An Admin account cannot be the capital partner.' });
    const active = await this.prisma.capitalPartner.findFirst({ where: { isActive: true } });
    if (active && active.accountId !== dto.accountId) throw new ConflictException({ code: 'PARTNER_ALREADY_DESIGNATED', message: 'The MVP has exactly one capital partner; deactivate the current one first.' });
    try {
      const saved = await this.prisma.capitalPartner.upsert({
        where: { accountId: dto.accountId }, create: { accountId: dto.accountId, displayName: dto.displayName.trim(), createdBy: actorId }, update: { displayName: dto.displayName.trim(), isActive: true },
      });
      return { id: saved.id, accountId: saved.accountId, displayName: saved.displayName, isActive: saved.isActive };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException({ code: 'PARTNER_ALREADY_DESIGNATED', message: 'The MVP has exactly one capital partner.' });
      throw error;
    }
  }

  async deactivate() {
    const partner = await this.prisma.capitalPartner.findFirst({ where: { isActive: true } });
    if (!partner) throw new NotFoundException({ code: 'NO_PARTNER', message: 'No active capital partner' });
    await this.prisma.capitalPartner.update({ where: { id: partner.id }, data: { isActive: false } });
    return { id: partner.id, isActive: false };
  }

  private presentEntry(row: { id: string; kind: string; amount: Prisma.Decimal; paidOn: Date; period: string | null; reference: string; note: string | null; createdAt: Date; voidedAt: Date | null; voidReason: string | null }) {
    return {
      id: row.id, kind: row.kind as EntryKind, amount: Number(row.amount), paidOn: row.paidOn.toISOString().slice(0, 10), period: row.period, reference: row.reference, note: row.note,
      recordedAt: row.createdAt.toISOString(), voided: !!row.voidedAt, voidReason: row.voidReason,
    };
  }

  async listEntries(limit = 100) {
    const partner = await this.prisma.capitalPartner.findFirst({ where: { isActive: true } });
    if (!partner) return [];
    return (await this.prisma.capitalPartnerEntry.findMany({ where: { partnerId: partner.id }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }], take: Math.min(limit, 300) })).map(row => this.presentEntry(row));
  }

  /**
   * Records money actually paid to the partner. Rules: a profit payout needs a COMPLETE month and can never exceed the share whose cash was
   * counted minus what was already paid for that month; a capital return can never exceed the capital still outstanding. The two checks and the
   * insert run under one advisory lock, and `idempotencyKey` makes a retried request return the same row instead of paying twice.
   */
  async recordEntry(dto: { kind: EntryKind; amount: number; paidOn: string; period?: string; reference: string; note?: string; idempotencyKey: string }, actorId: string) {
    const partner = await this.prisma.capitalPartner.findFirst({ where: { isActive: true } });
    if (!partner) throw new ConflictException({ code: 'NO_PARTNER', message: 'Designate the capital partner first.' });
    const amountCents = cents(dto.amount);
    const existing = await this.prisma.capitalPartnerEntry.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) {
      const same = existing.partnerId === partner.id && existing.kind === dto.kind && cents(existing.amount) === amountCents && existing.paidOn.toISOString().slice(0, 10) === dto.paidOn && (existing.period ?? null) === (dto.period ?? null);
      if (!same) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This key was already used for a different payment.' });
      return { ...this.presentEntry(existing), alreadyRecorded: true };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.paidOn) || new Date(`${dto.paidOn}T00:00:00Z`).toISOString().slice(0, 10) !== dto.paidOn) throw new BadRequestException({ code: 'INVALID_DATE', message: 'paidOn is not a valid date' });
    if (dto.paidOn > cairoYmd(new Date())) throw new BadRequestException({ code: 'DATE_IN_FUTURE', message: 'A payment cannot be dated in the future.' });
    if (dto.kind === 'PROFIT_PAYOUT') {
      if (!dto.period) throw new BadRequestException({ code: 'PERIOD_REQUIRED', message: 'A profit payout settles one profit month.' });
      this.assertPeriod(dto.period);
    } else if (dto.period) this.assertPeriod(dto.period);

    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('capital_partner_entries'))`;
      if (dto.kind === 'PROFIT_PAYOUT') {
        const { figures } = await this.figures(dto.period!);
        if (figures.status !== 'COMPLETE') throw new ConflictException({ code: 'PERIOD_INCOMPLETE', message: 'That month still has missing costs: nothing is payable until it is complete.' });
        const paid = cents((await tx.capitalPartnerEntry.aggregate({ where: { partnerId: partner.id, kind: 'PROFIT_PAYOUT', voidedAt: null, period: dto.period }, _sum: { amount: true } }))._sum.amount);
        const room = payoutRoom(figures, paid);
        if (amountCents > room) throw new ConflictException({ code: 'PAYOUT_EXCEEDS_PAYABLE', message: 'The amount is more than the partner share whose cash was counted and is still unpaid.', payableNow: money(room) });
      } else {
        const lifetime = await this.lifetimeBalances(partner.id);
        if (amountCents > lifetime.outstanding) throw new ConflictException({ code: 'RETURN_EXCEEDS_OUTSTANDING', message: 'The amount is more than the capital not returned yet.', outstanding: money(lifetime.outstanding) });
      }
      const row = await tx.capitalPartnerEntry.create({ data: {
        partnerId: partner.id, kind: dto.kind, amount: new Prisma.Decimal((amountCents / 100).toFixed(2)), paidOn: new Date(`${dto.paidOn}T00:00:00Z`), period: dto.period ?? null,
        reference: dto.reference.trim(), note: dto.note?.trim() || null, idempotencyKey: dto.idempotencyKey, recordedBy: actorId,
      } });
      return { ...this.presentEntry(row), alreadyRecorded: false };
    }, { timeout: 60_000, maxWait: 15_000 });
  }

  /** A wrong entry is voided with a reason (never edited or deleted); repeating the call changes nothing. */
  async voidEntry(id: string, reason: string, actorId: string) {
    const entry = await this.prisma.capitalPartnerEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException({ code: 'ENTRY_NOT_FOUND', message: 'No such entry' });
    if (entry.voidedAt) return this.presentEntry(entry);
    return this.presentEntry(await this.prisma.capitalPartnerEntry.update({ where: { id }, data: { voidedAt: new Date(), voidedBy: actorId, voidReason: reason.trim() } }));
  }
}
