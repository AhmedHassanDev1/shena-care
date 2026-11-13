import { computeProfit, EligibleOrder, LostOrder, shareOf } from '../../src/application/composition/services/profit-model';

/** Amounts are written in EGP and converted to cents so every expectation reads like the finance sheet. */
const c = (egp: number) => Math.round(egp * 100);

const order = (over: Partial<EligibleOrder> & { goods: number; fee?: number; cogs?: number | null; courier?: number | null; bag?: number | null }): EligibleOrder => ({
  orderId: `o-${Math.random()}`, orderNumber: 'ORD-1',
  goodsNet: c(over.goods), customerDeliveryFee: c(over.fee ?? 0),
  cogs: over.cogs === undefined ? 0 : over.cogs === null ? null : c(over.cogs),
  courierCost: over.courier === undefined ? 0 : over.courier === null ? null : c(over.courier),
  packagingCost: over.bag === undefined ? 0 : over.bag === null ? null : c(over.bag),
});

const base = { losses: [] as LostOrder[], refunds: 0, operatingExpenses: 0, profitSharePercent: 40 };

describe('profit model', () => {
  it('shares the configured percentage of net profit, not of sales or collected cash', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 1000, cogs: 600, courier: 0, bag: 0 })], operatingExpenses: c(100) });
    expect(result.status).toBe('COMPLETE');
    expect(result.revenue).toBe(c(1000));
    expect(result.netProfit).toBe(c(300)); // 1000 − 600 − 100
    expect(result.profitShare).toBe(c(120)); // 40% of 300, not 40% of 1000
  });

  it('keeps customer delivery fees out of revenue and charges only the company-funded difference', () => {
    const result = computeProfit({ ...base, orders: [
      order({ goods: 500, fee: 30, cogs: 300, courier: 50, bag: 5 }), // company funds 20
      order({ goods: 500, fee: 50, cogs: 300, courier: 50, bag: 5 }), // customer covers all
    ] });
    expect(result.revenue).toBe(c(1000)); // the 80 EGP of delivery fees are not sales
    expect(result.costs.companyFundedDelivery).toBe(c(20));
    expect(result.delivery).toEqual({ customerFees: c(80), courierCost: c(100), companyFunded: c(20), customerSurplus: c(0) });
    expect(result.netProfit).toBe(c(1000 - 600 - 20 - 10));
  });

  it('never turns a customer delivery surplus into profit or a negative cost', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 400, fee: 60, cogs: 200, courier: 40, bag: 0 })] });
    expect(result.costs.companyFundedDelivery).toBe(0);
    expect(result.delivery.customerSurplus).toBe(c(20));
    expect(result.netProfit).toBe(c(200));
  });

  it.each([
    ['purchase cost', { cogs: null }, 'PURCHASE_COST'],
    ['courier cost', { courier: null }, 'COURIER_COST'],
    ['packaging cost', { bag: null }, 'PACKAGING_COST'],
  ] as const)('is INCOMPLETE (not zero-cost) when the %s was never recorded', (_label, gap, code) => {
    const result = computeProfit({ ...base, orders: [order({ goods: 400, cogs: 200, courier: 0, bag: 0 }), order({ goods: 400, ...gap })] });
    expect(result.status).toBe('INCOMPLETE');
    expect(result.missing).toEqual([{ code, orders: 1 }]);
    expect(result.netProfit).toBeNull();
    expect(result.profitShare).toBeNull();
  });

  it('counts a loss once, separately from refunds, and withholds profit when a lost order has unrecorded cost', () => {
    const lost: LostOrder = { orderId: 'x', orderNumber: 'ORD-X', purchaseCost: c(80), courierCost: c(25), packagingCost: c(5) };
    const result = computeProfit({ ...base, orders: [order({ goods: 1000, cogs: 500, courier: 0, bag: 0 })], losses: [lost], refunds: c(60) });
    expect(result.revenue).toBe(c(940)); // refund reduces revenue
    expect(result.costs.losses).toBe(c(110)); // goods + courier + packaging of the cancelled order, once
    expect(result.netProfit).toBe(c(940 - 500 - 110));

    const unknown = computeProfit({ ...base, orders: [], losses: [{ ...lost, purchaseCost: null }] });
    expect(unknown.status).toBe('INCOMPLETE');
    expect(unknown.missing).toEqual([{ code: 'LOSS_PURCHASE_COST', orders: 1 }]);
  });

  it('pays no share in a loss-making month and reports the negative net', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 200, cogs: 150, courier: 0, bag: 0 })], operatingExpenses: c(300) });
    expect(result.netProfit).toBe(c(-250));
    expect(result.profitShare).toBe(0);
  });

  it('does not deduct initial capital on top of purchase costs: only recorded purchase cost of goods sold counts', () => {
    const result = computeProfit({ ...base, orders: [order({ goods: 300, cogs: 180, courier: 0, bag: 0 })] });
    expect(result.costs.total).toBe(c(180));
    expect(result.netProfit).toBe(c(120));
  });

  it('a different percentage changes only the share, never the net profit, and rounds to the piastre', () => {
    const orders = [order({ goods: 1000, cogs: 333.33, courier: 0, bag: 0 })];
    const at40 = computeProfit({ ...base, orders });
    const at375 = computeProfit({ ...base, orders, profitSharePercent: 37.5 });
    expect(at375.netProfit).toBe(at40.netProfit);
    expect(at375.profitShare).toBe(shareOf(c(666.67), 37.5));
    expect(at375.profitShare).toBe(25000); // 250.00 EGP (666.67 × 37.5% = 250.0012…)
    expect(at40.profitShare).toBe(26667); // 266.67 EGP
  });

  it('is COMPLETE and zero for a month with no activity at all', () => {
    const result = computeProfit({ ...base, orders: [] });
    expect(result.status).toBe('COMPLETE');
    expect(result.netProfit).toBe(0);
    expect(result.profitShare).toBe(0);
  });
});
