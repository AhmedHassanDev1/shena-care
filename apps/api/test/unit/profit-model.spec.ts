import { computeProfit, EligibleOrder, EndedOrder, ProfitInput, shareOf } from '../../src/application/composition/services/profit-model';

/** Amounts are written in EGP and converted to cents so every expectation reads like the finance sheet. */
const c = (egp: number) => Math.round(egp * 100);

/** One delivered order. `goods` is what the customer was billed for goods after every discount and coupon; `gross` the list total before an order coupon. */
const order = (over: { goods: number; gross?: number; fee?: number; cogs?: number | null; courier?: number | null; estimated?: boolean; bag?: number | null; realised?: boolean }): EligibleOrder => ({
  orderId: `o-${Math.random()}`, orderNumber: 'ORD-1',
  grossGoods: c(over.gross ?? over.goods), netGoods: c(over.goods), shippingRevenue: c(over.fee ?? 0),
  cogs: over.cogs === undefined ? 0 : over.cogs === null ? null : c(over.cogs),
  courier: over.courier === undefined ? 0 : over.courier === null ? null : c(over.courier), courierEstimated: over.estimated ?? false,
  packaging: over.bag === undefined ? 0 : over.bag === null ? null : c(over.bag),
  realised: over.realised ?? true,
});

const base: Omit<ProfitInput, 'orders'> = {
  ended: [], refunds: { goods: 0, deliveryFee: 0 }, damages: 0, directCosts: 0, unapprovedDirect: 0, platformExpenses: 0, platformPercent: 40,
};

describe('distributable profit model', () => {
  it('is the owner formula: net sales + shipping revenue − product cost − delivery − packaging − damages − approved direct costs', () => {
    // The reference order: goods 1,000, customer coupon 100, fee 35, purchase 700, actual delivery 25, packaging 10.
    const result = computeProfit({ ...base, orders: [order({ goods: 900, gross: 1000, fee: 35, cogs: 700, courier: 25, bag: 10 })] });
    expect(result.status).toBe('COMPLETE');
    expect(result.revenue).toMatchObject({ grossSales: c(1000), discounts: c(100), netSales: c(900), shippingRevenue: c(35), total: c(935) });
    expect(result.costs).toMatchObject({ products: c(700), delivery: c(25), packaging: c(10), total: c(735) });
    expect(result.distributableProfit).toBe(c(200)); // 900 + 35 − 700 − 25 − 10
    expect(result.delivery).toMatchObject({ revenue: c(35), cost: c(25), margin: c(10) });
  });

  it('counts a coupon once: net sales are what was billed, the list price is not used again', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 450, gross: 500, cogs: 200, courier: 0, bag: 0 })] });
    expect(result.revenue.netSales).toBe(c(450));
    expect(result.distributableProfit).toBe(c(250));
  });

  it('shows delivery as revenue and cost separately, so a surplus is profit and a free delivery is a full cost', () => {
    const surplus = computeProfit({ ...base, orders: [order({ goods: 100, fee: 35, cogs: 50, courier: 25, bag: 0 })] });
    expect(surplus.distributableProfit).toBe(c(60)); // 100 + 35 − 50 − 25
    const free = computeProfit({ ...base, orders: [order({ goods: 100, fee: 0, cogs: 50, courier: 25, bag: 0 })] });
    expect(free.distributableProfit).toBe(c(25));
  });

  it('subtracts goods refunds from net sales and delivery-fee refunds from shipping revenue, separately', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 400, fee: 35, cogs: 240, courier: 25, bag: 10 })], refunds: { goods: c(100), deliveryFee: c(35) } });
    expect(result.revenue).toMatchObject({ productRefunds: c(100), netSalesAfterRefunds: c(300), deliveryFeeRefunds: c(35), shippingRevenueNet: 0 });
    expect(result.distributableProfit).toBe(c(300 + 0 - 240 - 25 - 10)); // 25
  });

  it('keeps the estimated delivery cost apart from actual cost and says how many orders use it', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 100, cogs: 50, courier: 30, bag: 0 }), order({ goods: 100, cogs: 50, courier: 35, estimated: true, bag: 0 })] });
    expect(result.delivery).toMatchObject({ cost: c(65), estimatedOrders: 1, estimatedAmount: c(35) });
    expect(result.status).toBe('COMPLETE');
  });

  it('deducts confirmed damages and approved direct costs, and never the platform’s own expenses', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 1000, cogs: 500, courier: 0, bag: 0 })], damages: c(40), directCosts: c(60), platformExpenses: c(999) });
    expect(result.distributableProfit).toBe(c(400));
    expect(result.platformExpenses).toBe(c(999)); // shown, never deducted
    expect(result.costs).toMatchObject({ damages: c(40), directCosts: c(60) });
  });

  it('is not a loss when goods of ended orders are recoverable: only the courier and packaging they really cost count', () => {
    const ended: EndedOrder = { orderId: 'x', orderNumber: 'ORD-X', courier: c(25), packaging: c(10), recoverableCost: c(280) };
    const result = computeProfit({ ...base, orders: [order({ goods: 500, cogs: 200, courier: 0, bag: 0 })], ended: [ended] });
    expect(result.distributableProfit).toBe(c(500 - 200 - 25 - 10));
    expect(result.costs.damages).toBe(0); // the 280 bought for the ended order is not a loss
    expect(result.capital.tiedUpInRecoverableGoods).toBe(c(280));
  });

  it('counts ended orders whose purchase cost is unknown apart, without hiding the known recoverable goods', () => {
    const known: EndedOrder = { orderId: 'a', orderNumber: 'ORD-A', courier: 0, packaging: 0, recoverableCost: c(100) };
    const unknown: EndedOrder = { orderId: 'b', orderNumber: 'ORD-B', courier: 0, packaging: 0, recoverableCost: null };
    const result = computeProfit({ ...base, orders: [], ended: [known, unknown] });
    expect(result.capital).toMatchObject({ tiedUpInRecoverableGoods: c(100), recoverableUnknownOrders: 1 });
  });

  it('splits the profit: the platform takes the configured percentage, the capital partner the rest, and capital recovered is not profit', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 900, fee: 35, cogs: 700, courier: 25, bag: 10 })] });
    expect(result.split).toMatchObject({ platformPercent: 40, platformShare: c(80), partnerShare: c(120), platformShareNow: c(80), partnerShareNow: c(120) });
    expect(result.capital.recovered).toBe(c(735)); // 700 + 25 + 10 back to the partner, separate from his 120 of profit
  });

  it('pays out only what is collected: unsettled orders stay pending and their cost stays tied-up capital', () => {
    const result = computeProfit({ ...base, orders: [
      order({ goods: 900, fee: 35, cogs: 700, courier: 25, bag: 10, realised: true }),
      order({ goods: 450, fee: 35, cogs: 300, courier: 25, bag: 10, realised: false }),
    ] });
    expect(result.distributableProfit).toBe(c(200 + 150)); // 450 + 35 − 335
    expect(result.realisedProfit).toBe(c(200));
    expect(result.pendingCollection).toMatchObject({ orders: 1, profit: c(150) });
    expect(result.split.platformShare).toBe(c(140)); // 40% of 350, accrual
    expect(result.split.platformShareNow).toBe(c(80)); // 40% of the 200 whose cash is counted
    expect(result.capital).toMatchObject({ recovered: c(735), tiedUpInUnsettledOrders: c(335) });
  });

  it('withholds every profit figure while a cost is unrecorded or a direct cost awaits approval (never a silent zero)', () => {
    const noCost = computeProfit({ ...base, orders: [order({ goods: 100, cogs: null, courier: 0, bag: 0 })] });
    expect(noCost).toMatchObject({ status: 'INCOMPLETE', distributableProfit: null, realisedProfit: null, grossProfit: null });
    expect(noCost.split.platformShare).toBeNull();
    const noCourier = computeProfit({ ...base, orders: [order({ goods: 100, cogs: 1, courier: null, bag: 0 })] });
    expect(noCourier.missing).toEqual([{ code: 'COURIER_COST', orders: 1 }]);
    const unapproved = computeProfit({ ...base, orders: [], unapprovedDirect: 2 });
    expect(unapproved.missing).toEqual([{ code: 'DIRECT_COST_APPROVAL', orders: 2 }]);
  });

  it('does not carry a loss forward and gives the platform nothing in a loss month', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 100, cogs: 300, courier: 0, bag: 0 })] });
    expect(result.distributableProfit).toBe(c(-200));
    expect(result.split.platformShare).toBe(0);
    expect(result.split.partnerShare).toBe(c(-200));
  });

  it('rounds the share to the cent and accepts two-decimal percentages', () => {
    expect(shareOf(c(666.67), 37.5)).toBe(25000);
    expect(shareOf(c(666.67), 40)).toBe(26667);
    expect(shareOf(c(-5), 40)).toBe(0);
  });

  it('is COMPLETE and zero for a month with no activity at all', () => {
    const result = computeProfit({ ...base, orders: [] });
    expect(result.status).toBe('COMPLETE');
    expect(result.distributableProfit).toBe(0);
    expect(result.split.platformShare).toBe(0);
  });
});
