type Paged<T> = { total: number; items: T[] };
export interface Attention {
  supplyActionRequired: Paged<{
    orderId: string;
    orderNumber: string | null;
    category: string;
    unresolvedQuantity: number;
    since: string;
  }>;
  customerDecisionsPending: Paged<{
    orderId: string;
    orderNumber: string;
    reason: string;
    unresolvedQuantity: number;
    expiresAt: string;
  }>;
  distributionRequired: Paged<{
    purchaseOrderId: string;
    lineId: string;
    requestedQuantity: number;
    confirmedQuantity: number | null;
    orderAllocations: number;
  }>;
  failedDeliveries: Paged<{
    orderId: string;
    orderNumber: string | null;
    reasonCode: string | null;
    failedAt: string;
  }>;
  cashVariances: { short: Paged<CashRow>; over: Paged<CashRow> };
  deliveredUnsettled: Paged<CashRow>;
  eventFailures: { failed: EventRow[]; dead: EventRow[] };
  openCases: Paged<{
    id: string;
    title: string;
    priority: string;
    orderId: string | null;
    createdAt: string;
  }>;
}
type CashRow = {
  orderId: string;
  orderNumber: string;
  expectedAmount: string;
  declaredAmount: string | null;
  countedAmount: string | null;
  variance: string | null;
};
type EventRow = {
  id: string;
  eventType: string;
  consumer: string;
  aggregateId: string;
  attempts: number;
  lastError: string | null;
};
