/**
 * The approved ShinaCare profit model as pure arithmetic (no database, no clock): everything in integer cents.
 *
 *   revenue          = product sales of eligible (delivered) orders, net of discounts, minus refunds   — customer delivery fees are NOT revenue
 *   actual costs     = purchase cost of the goods sold
 *                    + company-funded delivery (actual courier cost beyond what the customer paid, per order, never below zero)
 *                    + packaging actually used
 *                    + losses (recorded cost of orders that were cancelled/returned, counted once, never with a refund)
 *                    + recorded operating expenses
 *   net profit       = revenue − actual costs      (initial capital is not deducted: it returns through purchase costs)
 *   profit share     = net profit × configured percentage when net profit is positive, otherwise 0
 *
 * A cost that was never recorded is never treated as zero: the period becomes INCOMPLETE and net profit / profit share are withheld.
 */

export interface EligibleOrder {
  orderId: string;
  orderNumber: string;
  /** Item sales net of discounts. */
  goodsNet: number;
  /** What the customer paid for delivery: informational, it only offsets the courier cost. */
  customerDeliveryFee: number;
  /** Purchase cost of the units sold; null while any unit has no recorded cost. */
  cogs: number | null;
  /** Actual courier cost for this order; null = not recorded. */
  courierCost: number | null;
  /** Actual packaging cost snapshot (BAG or BOX); null = not recorded. */
  packagingCost: number | null;
}

/** An order that ended cancelled or returned: whatever was already spent on it is a loss, once. */
export interface LostOrder {
  orderId: string;
  orderNumber: string;
  /** Purchase cost of units bought for it; null while some bought units have no recorded cost. */
  purchaseCost: number | null;
  courierCost: number;
  packagingCost: number;
}

export interface ProfitInput {
  orders: EligibleOrder[];
  losses: LostOrder[];
  /** Refunds paid on eligible orders in the period. */
  refunds: number;
  operatingExpenses: number;
  /** Configured share of net profit, e.g. 40 or 37.5. */
  profitSharePercent: number;
}

export type MissingCode = 'PURCHASE_COST' | 'COURIER_COST' | 'PACKAGING_COST' | 'LOSS_PURCHASE_COST';

export interface ProfitResult {
  status: 'COMPLETE' | 'INCOMPLETE';
  missing: Array<{ code: MissingCode; orders: number }>;
  eligibleOrders: number;
  /** Product sales net of discounts, before refunds. */
  productSales: number;
  refunds: number;
  revenue: number;
  costs: {
    purchase: number;
    companyFundedDelivery: number;
    packaging: number;
    losses: number;
    operatingExpenses: number;
    total: number;
  };
  /** Customer delivery fees collected, and the part of them that exceeded the courier cost: shown for transparency, never revenue or profit. */
  delivery: { customerFees: number; courierCost: number; companyFunded: number; customerSurplus: number };
  /** Null while INCOMPLETE. */
  netProfit: number | null;
  profitSharePercent: number;
  profitShare: number | null;
}

export const shareOf = (netProfitCents: number, percent: number): number =>
  netProfitCents > 0 ? Math.round((netProfitCents * Math.round(percent * 100)) / 10000) : 0;

export function computeProfit(input: ProfitInput): ProfitResult {
  let productSales = 0;
  let purchase = 0;
  let packaging = 0;
  let companyFunded = 0;
  let customerFees = 0;
  let courierTotal = 0;
  let surplus = 0;
  const counts: Record<MissingCode, number> = { PURCHASE_COST: 0, COURIER_COST: 0, PACKAGING_COST: 0, LOSS_PURCHASE_COST: 0 };

  for (const order of input.orders) {
    productSales += order.goodsNet;
    customerFees += order.customerDeliveryFee;
    if (order.cogs === null) counts.PURCHASE_COST += 1; else purchase += order.cogs;
    if (order.packagingCost === null) counts.PACKAGING_COST += 1; else packaging += order.packagingCost;
    if (order.courierCost === null) {
      counts.COURIER_COST += 1;
    } else {
      courierTotal += order.courierCost;
      const gap = order.courierCost - order.customerDeliveryFee;
      if (gap > 0) companyFunded += gap; else surplus += -gap;
    }
  }

  let losses = 0;
  for (const lost of input.losses) {
    if (lost.purchaseCost === null) counts.LOSS_PURCHASE_COST += 1; else losses += lost.purchaseCost;
    losses += lost.courierCost + lost.packagingCost;
  }

  const revenue = productSales - input.refunds;
  const total = purchase + companyFunded + packaging + losses + input.operatingExpenses;
  const missing = (Object.keys(counts) as MissingCode[]).filter(code => counts[code] > 0).map(code => ({ code, orders: counts[code] }));
  const complete = missing.length === 0;
  const netProfit = complete ? revenue - total : null;
  return {
    status: complete ? 'COMPLETE' : 'INCOMPLETE',
    missing,
    eligibleOrders: input.orders.length,
    productSales,
    refunds: input.refunds,
    revenue,
    costs: { purchase, companyFundedDelivery: companyFunded, packaging, losses, operatingExpenses: input.operatingExpenses, total },
    delivery: { customerFees, courierCost: courierTotal, companyFunded, customerSurplus: surplus },
    netProfit,
    profitSharePercent: input.profitSharePercent,
    profitShare: netProfit === null ? null : shareOf(netProfit, input.profitSharePercent),
  };
}
