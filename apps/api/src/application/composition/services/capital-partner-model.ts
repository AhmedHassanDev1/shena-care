/**
 * Capital partner arithmetic over figures the finance model already produced. Pure (no database, no clock), integer cents.
 *
 * NOTHING here recomputes a profit: the distributable profit, the platform / partner split, the capital recovered and the cash-pending
 * orders are READ from `profit-model.ts` (live) or from the frozen copy of a closed month. This file only (a) normalises either shape,
 * (b) subtracts what was actually paid to the partner, and (c) names the settlement state. Capital recovery and profit are always
 * separate numbers: a capital return is never counted as profit and a profit payout never reduces capital.
 */

export type MonthStatus = 'COMPLETE' | 'INCOMPLETE';

/** pending = costs missing (nothing is due yet) · none = no profit to share · unsettled = profit exists but its cash is still with couriers ·
 * due = payable and unpaid · partial = part paid · paid = fully paid. */
export type SettlementState = 'PENDING' | 'NO_PROFIT' | 'UNSETTLED' | 'DUE' | 'PARTIAL' | 'PAID';

/** One month's profit figures in cents, whatever shape they were stored in. `null` = withheld (incomplete month). */
export interface MonthFigures {
  status: MonthStatus;
  /** A month closed before the final profit model froze an older shape: only the totals it stored are known. */
  legacy: boolean;
  grossSales: number; discounts: number; netSales: number; productRefunds: number; shippingRevenue: number; deliveryFeeRefunds: number;
  products: number; delivery: number; packaging: number; damages: number; directCosts: number;
  distributable: number | null;
  platformPercent: number;
  platformShare: number | null; partnerShare: number | null;
  /** The same split applied to the part whose cash was counted: what can be paid out now. */
  partnerShareNow: number | null;
  capitalRecovered: number; capitalTiedUpUnsettled: number; capitalRecoverableGoods: number;
  pendingCollectionOrders: number;
  eligibleOrders: number;
  missing: Array<{ code: string; orders: number }>;
}

const cents = (value: unknown): number => Math.round(Number(value ?? 0) * 100);
const centsOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : cents(value));

/** Reads a presented (EGP) month — live or frozen at close — into cents. Older frozen months are flagged `legacy`, never reinterpreted. */
export function normaliseFigures(raw: Record<string, any>): MonthFigures { // eslint-disable-line @typescript-eslint/no-explicit-any -- a frozen month may carry an older shape
  const legacy = raw.distributableProfit === undefined;
  if (legacy) {
    const net = centsOrNull(raw.netProfit); const share = centsOrNull(raw.profitShare);
    return {
      status: raw.status === 'INCOMPLETE' ? 'INCOMPLETE' : 'COMPLETE', legacy: true,
      grossSales: 0, discounts: 0, netSales: cents(raw.revenue?.net), productRefunds: 0, shippingRevenue: 0, deliveryFeeRefunds: 0,
      products: 0, delivery: 0, packaging: 0, damages: 0, directCosts: 0,
      distributable: net, platformPercent: Number(raw.profitSharePercent ?? 0), platformShare: share, partnerShare: net === null || share === null ? null : net - share,
      partnerShareNow: net === null || share === null ? null : net - share,
      capitalRecovered: 0, capitalTiedUpUnsettled: 0, capitalRecoverableGoods: 0, pendingCollectionOrders: 0, eligibleOrders: Number(raw.eligibleOrders ?? 0), missing: [],
    };
  }
  return {
    status: raw.status === 'INCOMPLETE' ? 'INCOMPLETE' : 'COMPLETE', legacy: false,
    grossSales: cents(raw.revenue?.grossSales), discounts: cents(raw.revenue?.discounts), netSales: cents(raw.revenue?.netSales), productRefunds: cents(raw.revenue?.productRefunds),
    shippingRevenue: cents(raw.revenue?.shippingRevenue), deliveryFeeRefunds: cents(raw.revenue?.deliveryFeeRefunds),
    products: cents(raw.costs?.products), delivery: cents(raw.costs?.delivery), packaging: cents(raw.costs?.packaging), damages: cents(raw.costs?.damages), directCosts: cents(raw.costs?.directCosts),
    distributable: centsOrNull(raw.distributableProfit), platformPercent: Number(raw.split?.platformPercent ?? 0),
    platformShare: centsOrNull(raw.split?.platformShare), partnerShare: centsOrNull(raw.split?.partnerShare), partnerShareNow: centsOrNull(raw.split?.partnerShareNow),
    capitalRecovered: cents(raw.capital?.recovered), capitalTiedUpUnsettled: cents(raw.capital?.tiedUpInUnsettledOrders), capitalRecoverableGoods: cents(raw.capital?.tiedUpInRecoverableGoods),
    pendingCollectionOrders: Number(raw.pendingCollection?.orders ?? 0), eligibleOrders: Number(raw.eligibleOrders ?? 0),
    missing: Array.isArray(raw.missing) ? raw.missing.map((m: { code: string; orders: number }) => ({ code: m.code, orders: m.orders })) : [],
  };
}

/** What is still unpaid of the partner's accrued share (never below zero; an overpayment shows as 0 remaining). */
export const remainingShare = (figures: MonthFigures, paid: number): number | null =>
  figures.partnerShare === null ? null : Math.max(0, figures.partnerShare - paid);

/** The most that can be recorded as paid against this month right now: only cash that was counted is payable, and never twice. */
export const payoutRoom = (figures: MonthFigures, paid: number): number =>
  figures.status !== 'COMPLETE' || figures.partnerShareNow === null ? 0 : Math.max(0, figures.partnerShareNow - paid);

export function settlementState(figures: MonthFigures, paid: number): SettlementState {
  if (figures.status !== 'COMPLETE' || figures.partnerShare === null) return 'PENDING';
  if (figures.partnerShare <= 0) return 'NO_PROFIT';
  if (paid >= figures.partnerShare) return 'PAID';
  if (paid > 0) return 'PARTIAL';
  return payoutRoom(figures, paid) > 0 ? 'DUE' : 'UNSETTLED';
}

/** Partner percentage = what the platform does not take (display only; the amounts come from the model). */
export const partnerPercent = (platformPercent: number): number => Math.round((100 - platformPercent) * 100) / 100;

/** Unresolved goods = what was bought minus what was sold (net of sealed returns) minus confirmed damages. Null while any month lacks a cost. */
export function unresolvedGoods(input: { purchases: number; months: Array<Pick<MonthFigures, 'status' | 'products' | 'damages' | 'legacy'>> }): number | null {
  if (input.months.some(month => month.status !== 'COMPLETE' || month.legacy)) return null;
  const sold = input.months.reduce((sum, month) => sum + month.products, 0);
  const lost = input.months.reduce((sum, month) => sum + month.damages, 0);
  const value = input.purchases - sold - lost;
  // A negative balance means the cost records do not line up (e.g. cost captured on a different basis): withheld rather than shown as zero.
  return value < 0 ? null : value;
}

export const money = (valueInCents: number): number => valueInCents / 100;
export const moneyOrNull = (valueInCents: number | null): number | null => (valueInCents === null ? null : valueInCents / 100);
