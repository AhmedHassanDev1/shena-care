export type OverviewDays = 1 | 7 | 30

export type OrderStatusKey =
  | 'placed'
  | 'confirmed'
  | 'packing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned'

export interface NetRealizedSalesKpi {
  amount: number
  previousAmount: number
  changePercent: number | null
  shippingFeesExcluded: number
  refundsSubtracted: number
  deliveredOrdersCount: number
  sparkline: number[]
}

export interface ContributionProfitKpi {
  status: 'incomplete' | 'no_data'
  confirmedAmount: null
  goodsMarginOnly: number | null
  coveredOrdersCount: number
  totalDeliveredOrdersCount: number
  missingComponents: Array<'supplier_invoices' | 'packaging_costs' | 'delivery_expenses'>
}

export interface CountKpiMetric {
  count: number
  previousCount: number
  changePercent: number | null
  completionRate?: number | null
  sparkline: number[]
}

export interface SalesChartPoint {
  key: string
  label: string
  shortLabel: string
  orders: number
  delivered: number
  sales: number | null
  previousSales: number | null
}

export interface OrderDistributionItem {
  status: OrderStatusKey
  count: number
  percentage: number
  href: string
}

export interface ActionItem {
  id: string
  orderId?: string
  orderNumber?: string
  type: 'supply_shortage' | 'customer_decision' | 'failed_delivery' | 'cash_variance' | 'support_case'
  categoryLabel: string
  title: string
  description: string
  severity: 'critical' | 'warning' | 'info'
  createdAt: string
  actionLabel: string
  actionHref: string
  relatedIssueCount?: number
}

export interface StageCardData {
  id: 'awaiting_sourcing' | 'sourcing_receiving' | 'packing_fulfillment' | 'out_for_delivery' | 'exceptions_stalled'
  title: string
  count: number
  percentage: number
  subtitle: string
  footerText: string
  href: string
}

export interface CashAmount { amount: number; orders: number }

/** One definition of the cash position, shared with the Finance page. */
export interface CashPosition {
  /** Expected from customers, still on the road: not yet declared by the courier. */
  expectedOnRoad: CashAmount
  /** Declared by the courier as collected, not yet counted by the hub: money still in courier custody. */
  inCourierCustody: CashAmount
  disputed: CashAmount
  /** Counted by the hub in settlements of the period; variance = counted − declared. */
  settlements: { count: number; counted: number; declared: number; variance: number; fees: number }
  currency?: string
}

export interface CodFinancialSummary {
  cash?: CashPosition
  pendingCod: {
    amount: number
    shipmentCount: number
    currency: string
  }
  unresolvedVariance: {
    amount: number
    caseCount: number
    currency: string
    details: string | null
  }
}

export interface AdminOverviewData {
  days: OverviewDays
  kpis: {
    netRealizedSales: NetRealizedSalesKpi | null
    /** Removed from the API: the profit lives on the Finance page only. */
    contributionProfit?: ContributionProfitKpi | null
    newOrders: CountKpiMetric
    completedOrders: CountKpiMetric
    openOrders: { count: number }
  }
  salesChart: {
    days: OverviewDays
    granularity: 'hourly' | 'daily'
    hasFinancialAccess: boolean
    hasPreviousComparison: boolean
    series: SalesChartPoint[]
  }
  orderDistribution: {
    total: number
    items: OrderDistributionItem[]
  }
  actionRequired: {
    totalIssues: number
    affectedOrdersCount: number
    standaloneCasesCount: number
    criticalCount: number
    items: ActionItem[]
  }
  stageBoard: {
    totalActive: number
    stages: StageCardData[]
  }
  financialSummary: CodFinancialSummary | null
  lastUpdated: string
}
