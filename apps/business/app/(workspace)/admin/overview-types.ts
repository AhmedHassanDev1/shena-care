export interface OverviewKpiMetric {
  count: number
  yesterdayCount?: number
  changePercent?: number | null
  deliveredRate?: number | null
  status?: string
  criticalCount?: number
  sparkline: number[]
}

export interface ActivityChartPoint {
  date: string
  dayName: string
  shortDate: string
  created: number
  delivered: number
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

export interface FinancialMetric {
  amount: number
  currency: string
  shipmentCount?: number
  transactionCount?: number
  caseCount?: number
  details?: string | null
}

export interface AdminOverviewData {
  kpis: {
    ordersToday: OverviewKpiMetric
    openOrders: OverviewKpiMetric
    deliveredToday: OverviewKpiMetric
    needsIntervention: OverviewKpiMetric
  }
  activityChart: {
    days: number
    series: ActivityChartPoint[]
  }
  actionRequired: {
    total: number
    criticalCount: number
    items: ActionItem[]
  }
  stageBoard: {
    totalActive: number
    stages: StageCardData[]
  }
  financialSummary: {
    pendingCod: FinancialMetric
    collectedToday: FinancialMetric
    unresolvedVariance: FinancialMetric
    totalReceivedToday: FinancialMetric
  }
  lastUpdated: string
}
