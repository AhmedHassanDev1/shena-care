/**
 * The approved ShinaCare profit model as pure arithmetic (no database, no clock): everything in integer cents.
 *
 *   Distributable profit = Net sales + Shipping revenue − Actual product cost − Delivery − Packaging − Confirmed damages − Approved direct costs
 *
 *   Net sales          = what the customer was billed for goods after every discount and coupon (order total − delivery fee), minus goods refunds.
 *                        A compare-at "saving" is already inside the unit price and is never deducted a second time.
 *   Shipping revenue   = delivery fees the customers paid, minus delivery-fee refunds. It is revenue; the courier cost is a cost, never netted.
 *   Actual product cost= purchase cost of the units sold (Buy List batch cost, list − supplier discount), minus the cost of units that came back
 *                        sealed and intact (they return to stock). Units that came back damaged keep their cost: it is counted once, here.
 *   Delivery           = actual courier cost per order; the quote's base fee only stands in (labelled estimated) while no actual cost exists.
 *                        Orders cancelled or returned after a trip keep the cost they really caused.
 *   Packaging          = bag/box cost actually used.
 *   Confirmed damages  = purchase cost of goods bought for cancelled/returned orders that an Admin confirmed as damaged. Goods bought for such
 *                        orders are otherwise RECOVERABLE: not a loss, shown as capital still tied up.
 *   Approved direct costs = recorded DIRECT expenses an Admin approved. The platform's own (PLATFORM) expenses are shown, never deducted.
 *
 *   Platform share     = configured percentage of the distributable profit (when positive); the capital partner receives the rest.
 *   Capital recovered  = the product, delivery and packaging cost of orders whose cash was counted: it goes back to the partner and is NOT profit.
 *   Payable now        = the same split applied only to orders whose cash was actually counted and settled (or paid online). Delivered orders whose
 *                        cash is still with a courier stay "pending collection": nothing is paid out on them yet.
 *
 * A cost that was never recorded is never treated as zero: the period becomes INCOMPLETE and every profit figure is withheld.
 * Loss carry-forward is not applied (no policy yet): a loss month gives the platform nothing and the next month starts clean.
 */

export interface EligibleOrder {
  orderId: string;
  orderNumber: string;
  /** Σ active line totals, before an order-level coupon. */
  grossGoods: number;
  /** What the customer was billed for goods after every discount (order total − delivery fee). */
  netGoods: number;
  /** Delivery fee the customer paid. */
  shippingRevenue: number;
  /** Purchase cost of the units sold net of sealed returns; null while any unit has no recorded cost. */
  cogs: number | null;
  /** Actual courier cost, or the quote's base fee while no actual exists; null = neither. */
  courier: number | null;
  courierEstimated: boolean;
  /** Packaging cost snapshot (BAG or BOX); null = not recorded. */
  packaging: number | null;
  /** The cash of this order was counted and settled (or it was paid online). */
  realised: boolean;
}

/** An order that ended cancelled or returned in the period: only what it really cost is counted; its bought goods stay recoverable. */
export interface EndedOrder {
  orderId: string;
  orderNumber: string;
  courier: number;
  packaging: number;
  /** Purchase cost of goods bought for it, not confirmed damaged (informational: capital tied up). Null while some unit has no cost. */
  recoverableCost: number | null;
}

export interface ProfitInput {
  orders: EligibleOrder[];
  ended: EndedOrder[];
  /** Succeeded refunds in the period, split into goods and delivery fee. */
  refunds: { goods: number; deliveryFee: number };
  /** Damages an Admin confirmed in the period. */
  damages: number;
  /** Approved DIRECT expenses in the period. */
  directCosts: number;
  /** DIRECT expenses recorded but not yet approved (they block the result until approved or voided). */
  unapprovedDirect: number;
  /** PLATFORM expenses in the period: shown, never deducted. */
  platformExpenses: number;
  /** Configured share of the distributable profit, e.g. 40 or 37.5. */
  platformPercent: number;
}

export type MissingCode = 'PURCHASE_COST' | 'COURIER_COST' | 'PACKAGING_COST' | 'DIRECT_COST_APPROVAL';

export interface ProfitResult {
  status: 'COMPLETE' | 'INCOMPLETE';
  missing: Array<{ code: MissingCode; orders: number }>;
  eligibleOrders: number;
  revenue: {
    grossSales: number; discounts: number; netSales: number; productRefunds: number; netSalesAfterRefunds: number;
    shippingRevenue: number; deliveryFeeRefunds: number; shippingRevenueNet: number; total: number;
  };
  costs: { products: number; delivery: number; packaging: number; damages: number; directCosts: number; total: number };
  delivery: { revenue: number; cost: number; margin: number; estimatedOrders: number; estimatedAmount: number };
  /** Null while INCOMPLETE. */
  distributableProfit: number | null;
  /** The part of the distributable profit whose cash is already counted; null while INCOMPLETE. */
  realisedProfit: number | null;
  pendingCollection: { orders: number; profit: number | null };
  split: {
    platformPercent: number;
    /** On the whole distributable profit (accrual). */
    platformShare: number | null; partnerShare: number | null;
    /** On the realised part only: what can be paid now. */
    platformShareNow: number | null; partnerShareNow: number | null;
  };
  /** tiedUpInRecoverableGoods: purchase cost of goods bought for cancelled / returned orders and still reusable (known costs only; orders whose cost is unknown are counted apart). */
  capital: { recovered: number; tiedUpInUnsettledOrders: number; tiedUpInRecoverableGoods: number; recoverableUnknownOrders: number };
  platformExpenses: number;
  /** Net sales after refunds minus the product cost, before delivery, packaging, damages and direct costs. */
  grossProfit: number | null;
}

export const shareOf = (profitCents: number, percent: number): number =>
  profitCents > 0 ? Math.round((profitCents * Math.round(percent * 100)) / 10000) : 0;

export function computeProfit(input: ProfitInput): ProfitResult {
  const counts: Record<MissingCode, number> = { PURCHASE_COST: 0, COURIER_COST: 0, PACKAGING_COST: 0, DIRECT_COST_APPROVAL: input.unapprovedDirect };
  let grossSales = 0; let netSales = 0; let shipping = 0; let discounts = 0;
  let cogs = 0; let courier = 0; let packaging = 0; let estimatedOrders = 0; let estimatedAmount = 0;
  // The same sums restricted to the orders whose cash is counted.
  let netR = 0; let shipR = 0; let cogsR = 0; let courierR = 0; let packR = 0; let pending = 0;
  let pendingBase = 0; let tiedUp = 0; let recovered = 0;

  for (const order of input.orders) {
    grossSales += order.grossGoods; netSales += order.netGoods; shipping += order.shippingRevenue;
    // Per order, so an order whose bill exceeds its lines never cancels another order's coupon.
    discounts += Math.max(0, order.grossGoods - order.netGoods);
    if (order.cogs === null) counts.PURCHASE_COST += 1; else cogs += order.cogs;
    if (order.courier === null) counts.COURIER_COST += 1;
    else { courier += order.courier; if (order.courierEstimated) { estimatedOrders += 1; estimatedAmount += order.courier; } }
    if (order.packaging === null) counts.PACKAGING_COST += 1; else packaging += order.packaging;

    const cost = (order.cogs ?? 0) + (order.courier ?? 0) + (order.packaging ?? 0);
    if (order.realised) {
      netR += order.netGoods; shipR += order.shippingRevenue; cogsR += order.cogs ?? 0; courierR += order.courier ?? 0; packR += order.packaging ?? 0;
      recovered += cost;
    } else {
      pending += 1; pendingBase += order.netGoods + order.shippingRevenue - cost; tiedUp += cost;
    }
  }

  let endedCosts = 0; let recoverable = 0; let recoverableUnknown = 0;
  for (const ended of input.ended) {
    courier += ended.courier; packaging += ended.packaging; endedCosts += ended.courier + ended.packaging;
    if (ended.recoverableCost === null) recoverableUnknown += 1; else recoverable += ended.recoverableCost;
  }

  const productRefunds = input.refunds.goods; const feeRefunds = input.refunds.deliveryFee;
  const netAfter = netSales - productRefunds; const shippingNet = shipping - feeRefunds;
  const costsTotal = cogs + courier + packaging + input.damages + input.directCosts;
  const periodAdjustments = productRefunds + feeRefunds + endedCosts + input.damages + input.directCosts;

  const missing = (Object.keys(counts) as MissingCode[]).filter(code => counts[code] > 0).map(code => ({ code, orders: counts[code] }));
  const complete = missing.length === 0;
  const distributable = netAfter + shippingNet - costsTotal;
  // Period-level items (refunds, damages, direct costs, costs of ended orders) are spent in full, so they reduce the realised part entirely.
  const realised = netR + shipR - cogsR - courierR - packR - periodAdjustments;
  const platform = shareOf(distributable, input.platformPercent);
  const platformNow = shareOf(realised, input.platformPercent);

  return {
    status: complete ? 'COMPLETE' : 'INCOMPLETE',
    missing,
    eligibleOrders: input.orders.length,
    revenue: {
      grossSales, discounts, netSales, productRefunds, netSalesAfterRefunds: netAfter,
      shippingRevenue: shipping, deliveryFeeRefunds: feeRefunds, shippingRevenueNet: shippingNet, total: netAfter + shippingNet,
    },
    costs: { products: cogs, delivery: courier, packaging, damages: input.damages, directCosts: input.directCosts, total: costsTotal },
    delivery: { revenue: shippingNet, cost: courier, margin: shippingNet - courier, estimatedOrders, estimatedAmount },
    distributableProfit: complete ? distributable : null,
    realisedProfit: complete ? realised : null,
    pendingCollection: { orders: pending, profit: complete ? pendingBase : null },
    split: {
      platformPercent: input.platformPercent,
      platformShare: complete ? platform : null, partnerShare: complete ? distributable - platform : null,
      platformShareNow: complete ? platformNow : null, partnerShareNow: complete ? realised - platformNow : null,
    },
    capital: { recovered, tiedUpInUnsettledOrders: tiedUp, tiedUpInRecoverableGoods: recoverable, recoverableUnknownOrders: recoverableUnknown },
    platformExpenses: input.platformExpenses,
    grossProfit: complete ? netAfter - cogs : null,
  };
}
