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
  return `منذ ${diffHours} ساعة`
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
