export type OverviewDays = 1 | 7 | 30;

export interface DeliveredOrderFinancialInput {
  orderId: string;
  deliveredAt: Date;
  expectedOrTotal: number;
  shippingFee: number;
}

export interface RefundInput {
  amount: number;
  at: Date;
}

export interface ActionCandidate {
  id: string;
  orderId?: string;
  orderNumber?: string;
  type: 'supply_shortage' | 'customer_decision' | 'failed_delivery' | 'cash_variance' | 'support_case';
  categoryLabel: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  createdAt: string;
  actionLabel: string;
  actionHref: string;
  relatedIssueCount?: number;
}

const SEVERITY_WEIGHT: Record<ActionCandidate['severity'], number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function calcPeriodChangePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Computes net product sales (goods value excluding customer-paid shipping fees, minus succeeded refunds).
 */
export function computeNetRealizedSales(
  deliveredOrders: DeliveredOrderFinancialInput[],
  refunds: RefundInput[],
): {
  netSales: number;
  goodsRevenue: number;
  shippingFeesExcluded: number;
  refundsSubtracted: number;
} {
  let goodsRevenue = 0;
  let shippingFeesExcluded = 0;
  for (const order of deliveredOrders) {
    const fee = Math.max(0, order.shippingFee);
    goodsRevenue += order.expectedOrTotal - fee;
    shippingFeesExcluded += fee;
  }
  const refundsSubtracted = refunds.reduce((sum, r) => sum + r.amount, 0);
  const netSales = roundMoney(goodsRevenue - refundsSubtracted);

  return {
    netSales,
    goodsRevenue: roundMoney(goodsRevenue),
    shippingFeesExcluded: roundMoney(shippingFeesExcluded),
    refundsSubtracted: roundMoney(refundsSubtracted),
  };
}

/**
 * Ranks action candidates by severity and recency, deduplicating by orderId so the top-N list
 * surfaces distinct urgent orders rather than repeating the same order across categories.
 */
export function selectTopUniqueActionItems(
  candidates: ActionCandidate[],
  limit = 3,
): ActionCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    const sevDiff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const issueCountByOrder = new Map<string, number>();
  for (const item of sorted) {
    if (item.orderId) {
      issueCountByOrder.set(item.orderId, (issueCountByOrder.get(item.orderId) ?? 0) + 1);
    }
  }

  const seenOrders = new Set<string>();
  const picked: ActionCandidate[] = [];

  for (const item of sorted) {
    if (item.orderId) {
      if (seenOrders.has(item.orderId)) continue;
      seenOrders.add(item.orderId);
      const countForOrder = issueCountByOrder.get(item.orderId) ?? 1;
      picked.push(
        countForOrder > 1
          ? { ...item, relatedIssueCount: countForOrder - 1 }
          : item,
      );
    } else {
      picked.push(item);
    }
    if (picked.length >= limit) break;
  }

  return picked;
}

export interface OrderItemContributionInput {
  id: string;
  quantity: number;
  price: number;
  discountAmount: number;
  lineTotal: number | null;
}

export interface OrderAllocationCostInput {
  orderItemId: string;
  receivedQuantity: number;
  lineReceivedTotal: number;
  lineCostedTotal: number;
  lineCapturedValue: number;
}

/**
 * Evaluates whether a delivered order has 100% captured supplier invoice COGS across all its items.
 * Returns null goods margin if any line is unallocated, unreceived, or COST_PENDING.
 */
export function evaluateOrderGoodsMargin(
  items: OrderItemContributionInput[],
  allocations: OrderAllocationCostInput[],
): { complete: boolean; goodsMargin: number | null } {
  if (!items.length) {
    return { complete: false, goodsMargin: null };
  }

  let totalRevenue = 0;
  let totalCogs = 0;

  for (const item of items) {
    const related = allocations.filter((a) => a.orderItemId === item.id);
    const receivedQty = related.reduce((sum, a) => sum + a.receivedQuantity, 0);
    if (receivedQty <= 0) {
      return { complete: false, goodsMargin: null };
    }

    const unitNetPrice =
      item.lineTotal !== null && item.quantity > 0
        ? item.lineTotal / item.quantity
        : item.price - item.discountAmount / Math.max(item.quantity, 1);

    let itemCogs = 0;
    for (const link of related) {
      if (link.receivedQuantity <= 0) continue;
      if (link.lineReceivedTotal <= 0 || link.lineCostedTotal < link.lineReceivedTotal) {
        return { complete: false, goodsMargin: null };
      }
      itemCogs += (link.lineCapturedValue * link.receivedQuantity) / link.lineReceivedTotal;
    }

    totalRevenue += unitNetPrice * receivedQty;
    totalCogs += itemCogs;
  }

  return {
    complete: true,
    goodsMargin: roundMoney(totalRevenue - totalCogs),
  };
}
