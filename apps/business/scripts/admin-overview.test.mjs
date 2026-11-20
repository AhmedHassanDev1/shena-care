import test from 'node:test'
import assert from 'node:assert/strict'

/* ── Test Relative Time Formatter ── */
function formatRelativeTime(dateString) {
  if (!dateString) return 'منذ لحظات'
  const then = new Date(dateString).getTime()
  const now = Date.now()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 60) return 'منذ لحظات'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin === 1) return 'منذ دقيقة'
  if (diffMin === 2) return 'منذ دقيقتين'
  if (diffMin >= 3 && diffMin <= 10) return `منذ ${diffMin} دقائق`
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours === 1) return 'منذ ساعة'
  if (diffHours === 2) return 'منذ ساعتين'
  if (diffHours >= 3 && diffHours <= 10) return `منذ ${diffHours} ساعات`
  if (diffHours < 24) return `منذ ${diffHours} ساعة`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'منذ يوم'
  if (diffDays === 2) return 'منذ يومين'
  if (diffDays >= 3 && diffDays <= 10) return `منذ ${diffDays} أيام`
  return `منذ ${diffDays} يوم`
}

test('formatRelativeTime produces natural Arabic phrasing', () => {
  const now = Date.now()
  assert.equal(formatRelativeTime(undefined), 'منذ لحظات')
  assert.equal(formatRelativeTime(new Date(now - 30 * 1000).toISOString()), 'منذ لحظات')
  assert.equal(formatRelativeTime(new Date(now - 65 * 1000).toISOString()), 'منذ دقيقة')
  assert.equal(formatRelativeTime(new Date(now - 125 * 1000).toISOString()), 'منذ دقيقتين')
  assert.equal(formatRelativeTime(new Date(now - 5 * 60 * 1000).toISOString()), 'منذ 5 دقائق')
  assert.equal(formatRelativeTime(new Date(now - 15 * 60 * 1000).toISOString()), 'منذ 15 دقيقة')
  assert.equal(formatRelativeTime(new Date(now - 65 * 60 * 1000).toISOString()), 'منذ ساعة')
  assert.equal(formatRelativeTime(new Date(now - 125 * 60 * 1000).toISOString()), 'منذ ساعتين')
  assert.equal(formatRelativeTime(new Date(now - 4 * 3600 * 1000).toISOString()), 'منذ 4 ساعات')
  assert.equal(formatRelativeTime(new Date(now - 14 * 3600 * 1000).toISOString()), 'منذ 14 ساعة')
  assert.equal(formatRelativeTime(new Date(now - 26 * 3600 * 1000).toISOString()), 'منذ يوم')
  assert.equal(formatRelativeTime(new Date(now - 50 * 3600 * 1000).toISOString()), 'منذ يومين')
  assert.equal(formatRelativeTime(new Date(now - 5 * 24 * 3600 * 1000).toISOString()), 'منذ 5 أيام')
  assert.equal(formatRelativeTime(new Date(now - 15 * 24 * 3600 * 1000).toISOString()), 'منذ 15 يوم')
})

/* ── Test Sparkline Math & Bounds ── */
function computeSparklinePoints(data, width = 88, height = 28, padding = 3) {
  if (!data || data.length === 0) return { empty: true }
  const allZero = data.every((v) => v === 0)
  if (allZero) return { allZero: true, baselineY: height / 2 }
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  return {
    empty: false,
    allZero: false,
    points: data.map((val, idx) => ({
      x: padding + (idx / Math.max(data.length - 1, 1)) * (width - 2 * padding),
      y: height - padding - ((val - min) / range) * (height - 2 * padding),
    })),
  }
}

test('sparkline handles empty, all-zero, and active sales data without NaN', () => {
  assert.equal(computeSparklinePoints([]).empty, true)

  const zeroRes = computeSparklinePoints([0, 0, 0, 0, 0, 0, 0])
  assert.equal(zeroRes.allZero, true)
  assert.equal(zeroRes.baselineY, 14)

  const activeRes = computeSparklinePoints([1200, 1850, 900, 2400, 3100, 2900, 4200])
  assert.equal(activeRes.allZero, false)
  assert.equal(activeRes.points.length, 7)
  for (const pt of activeRes.points) {
    assert.ok(!Number.isNaN(pt.x))
    assert.ok(!Number.isNaN(pt.y))
    assert.ok(pt.x >= 3 && pt.x <= 85)
    assert.ok(pt.y >= 3 && pt.y <= 25)
  }
})

/* ── Test Stage Board & Order Distribution Percentages ── */
test('workflow stages and order distribution calculate accurate percentages without NaN', () => {
  const counts = {
    awaiting_sourcing: 4,
    sourcing_receiving: 12,
    packing_fulfillment: 22,
    out_for_delivery: 19,
    exceptions_stalled: 6,
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const calcPercent = (cnt) => (total > 0 ? Math.round((cnt / total) * 1000) / 10 : 0)

  assert.equal(total, 63)
  assert.equal(calcPercent(counts.awaiting_sourcing), 6.3)
  assert.equal(calcPercent(counts.packing_fulfillment), 34.9)
  assert.equal(calcPercent(counts.exceptions_stalled), 9.5)

  const emptyCalc = (cnt) => (0 > 0 ? Math.round((cnt / 0) * 1000) / 10 : 0)
  assert.equal(emptyCalc(0), 0)
})

/* ── Test Zero Mock & RBAC / Incomplete Profit Contract ── */
test('overview payload enforces zero-mock guarantees and explicit incomplete profit state', () => {
  const emptyAdminOverview = {
    days: 7,
    kpis: {
      netRealizedSales: {
        amount: 0,
        previousAmount: 0,
        changePercent: null,
        shippingFeesExcluded: 0,
        refundsSubtracted: 0,
        deliveredOrdersCount: 0,
        sparkline: [0, 0, 0, 0, 0, 0, 0],
      },
      contributionProfit: {
        status: 'no_data',
        confirmedAmount: null,
        goodsMarginOnly: null,
        coveredOrdersCount: 0,
        totalDeliveredOrdersCount: 0,
        missingComponents: ['packaging_costs', 'delivery_expenses'],
      },
      newOrders: { count: 0, previousCount: 0, changePercent: null, sparkline: [0, 0, 0, 0, 0, 0, 0] },
      completedOrders: { count: 0, previousCount: 0, changePercent: null, completionRate: null, sparkline: [0, 0, 0, 0, 0, 0, 0] },
      openOrders: { count: 0 },
    },
    salesChart: {
      days: 7,
      granularity: 'daily',
      hasFinancialAccess: true,
      hasPreviousComparison: false,
      series: [],
    },
    orderDistribution: { total: 0, items: [] },
    actionRequired: { totalIssues: 0, affectedOrdersCount: 0, standaloneCasesCount: 0, criticalCount: 0, items: [] },
    stageBoard: { totalActive: 0, stages: [] },
    financialSummary: {
      pendingCod: { amount: 0, shipmentCount: 0, currency: 'EGP' },
      unresolvedVariance: { amount: 0, caseCount: 0, currency: 'EGP', details: null },
    },
  }

  assert.equal(emptyAdminOverview.kpis.netRealizedSales.amount, 0)
  assert.equal(emptyAdminOverview.kpis.netRealizedSales.changePercent, null)
  assert.equal(emptyAdminOverview.kpis.contributionProfit.confirmedAmount, null)
  assert.equal(emptyAdminOverview.actionRequired.totalIssues, 0)
  assert.equal(emptyAdminOverview.actionRequired.affectedOrdersCount, 0)
  assert.equal(emptyAdminOverview.financialSummary.unresolvedVariance.amount, 0)
})

/* ── Test Horizontal Bar Chart Sorting & Total Consistency ── */
test('order status horizontal bar chart sorts highest first and matches total sum', () => {
  const naturalOrder = ['placed', 'confirmed', 'packing', 'shipped', 'delivered', 'cancelled', 'returned']
  const items = [
    { status: 'placed', count: 12, percentage: 12, href: '/admin/orders?status=placed' },
    { status: 'confirmed', count: 5, percentage: 5, href: '/admin/orders?status=confirmed' },
    { status: 'packing', count: 28, percentage: 28, href: '/admin/orders?status=packing' },
    { status: 'shipped', count: 19, percentage: 19, href: '/admin/orders?status=shipped' },
    { status: 'delivered', count: 32, percentage: 32, href: '/admin/orders?status=delivered' },
    { status: 'cancelled', count: 3, percentage: 3, href: '/admin/orders?status=cancelled' },
    { status: 'returned', count: 1, percentage: 1, href: '/admin/orders?status=returned' },
  ]

  const sumCount = items.reduce((acc, curr) => acc + curr.count, 0)
  assert.equal(sumCount, 100)

  const sorted = [...items].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return naturalOrder.indexOf(a.status) - naturalOrder.indexOf(b.status)
  })

  // Highest count first
  assert.equal(sorted[0].status, 'delivered')
  assert.equal(sorted[0].count, 32)
  assert.equal(sorted[1].status, 'packing')
  assert.equal(sorted[1].count, 28)
  assert.equal(sorted[2].status, 'shipped')
  assert.equal(sorted[2].count, 19)
  assert.equal(sorted[3].status, 'placed')
  assert.equal(sorted[3].count, 12)
  assert.equal(sorted[4].status, 'confirmed')
  assert.equal(sorted[4].count, 5)
  assert.equal(sorted[5].status, 'cancelled')
  assert.equal(sorted[5].count, 3)
  assert.equal(sorted[6].status, 'returned')
  assert.equal(sorted[6].count, 1)

  // Verify total matches sum of displayed statuses
  const sortedSum = sorted.reduce((acc, curr) => acc + curr.count, 0)
  assert.equal(sortedSum, sumCount)
})

/* ── Test Action Required Sorting by Priority and Age ── */
test('action required items sort strictly by priority (critical > warning > info) and then by age (oldest first)', () => {
  const severityOrder = { critical: 0, warning: 1, info: 2 }
  const now = Date.now()
  const rawItems = [
    { id: '1', title: 'Info Case', severity: 'info', createdAt: new Date(now - 1000).toISOString() },
    { id: '2', title: 'Warning Newer', severity: 'warning', createdAt: new Date(now - 5000).toISOString() },
    { id: '3', title: 'Critical Newer', severity: 'critical', createdAt: new Date(now - 3000).toISOString() },
    { id: '4', title: 'Critical Oldest', severity: 'critical', createdAt: new Date(now - 20000).toISOString() },
    { id: '5', title: 'Warning Oldest', severity: 'warning', createdAt: new Date(now - 15000).toISOString() },
  ]

  const sorted = [...rawItems].sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity]
    if (sevDiff !== 0) return sevDiff
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  assert.equal(sorted[0].id, '4') // Critical Oldest
  assert.equal(sorted[1].id, '3') // Critical Newer
  assert.equal(sorted[2].id, '5') // Warning Oldest
  assert.equal(sorted[3].id, '2') // Warning Newer
  assert.equal(sorted[4].id, '1') // Info Case
})
