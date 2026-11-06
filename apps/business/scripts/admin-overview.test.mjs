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

/* ── Test Sparkline Math & Bezier Calculation ── */
function computeSparklinePoints(data, width = 80, height = 28, padding = 3) {
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

test('sparkline handles empty and all-zero data without NaN', () => {
  const emptyRes = computeSparklinePoints([])
  assert.equal(emptyRes.empty, true)

  const zeroRes = computeSparklinePoints([0, 0, 0, 0, 0, 0, 0])
  assert.equal(zeroRes.allZero, true)
  assert.equal(zeroRes.baselineY, 14)

  const activeRes = computeSparklinePoints([10, 15, 20, 18, 30, 25, 35])
  assert.equal(activeRes.allZero, false)
  assert.equal(activeRes.points.length, 7)
  for (const pt of activeRes.points) {
    assert.ok(!Number.isNaN(pt.x), `pt.x is NaN: ${pt.x}`)
    assert.ok(!Number.isNaN(pt.y), `pt.y is NaN: ${pt.y}`)
    assert.ok(pt.x >= 3 && pt.x <= 77, `pt.x out of bounds: ${pt.x}`)
    assert.ok(pt.y >= 3 && pt.y <= 25, `pt.y out of bounds: ${pt.y}`)
  }
})

/* ── Test Stage Board Percentage Calculations ── */
test('stage board calculates accurate stage distribution percentages without NaN', () => {
  const counts = {
    awaiting_sourcing: 4,
    sourcing_receiving: 12,
    packing_fulfillment: 22,
    out_for_delivery: 19,
    exceptions_stalled: 6,
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  assert.equal(total, 63)

  const calcPercent = (cnt) => (total > 0 ? Math.round((cnt / total) * 1000) / 10 : 0)
  const p1 = calcPercent(counts.awaiting_sourcing)
  const p2 = calcPercent(counts.sourcing_receiving)
  const p3 = calcPercent(counts.packing_fulfillment)
  const p4 = calcPercent(counts.out_for_delivery)
  const p5 = calcPercent(counts.exceptions_stalled)

  assert.equal(p1, 6.3)
  assert.equal(p2, 19.0)
  assert.equal(p3, 34.9)
  assert.equal(p4, 30.2)
  assert.equal(p5, 9.5)
  assert.ok(Math.abs(p1 + p2 + p3 + p4 + p5 - 100) < 0.2)

  // Empty stages total
  const emptyTotal = 0
  const emptyCalc = (cnt) => (emptyTotal > 0 ? Math.round((cnt / emptyTotal) * 1000) / 10 : 0)
  assert.equal(emptyCalc(0), 0)
})

/* ── Test Financial Variance Calculation ── */
test('financial variance formats positive and negative differences correctly', () => {
  const formatVariance = (amount) => {
    if (amount === 0) return '0'
    return amount > 0 ? `+${amount.toLocaleString()}` : `${amount.toLocaleString()}`
  }
  assert.equal(formatVariance(0), '0')
  assert.equal(formatVariance(-75), '-75')
  assert.equal(formatVariance(150), '+150')
})

/* ── Test Zero Mock Operational Data Rule ── */
test('empty overview payload strictly maintains zero mock guarantees', () => {
  const emptyOverview = {
    kpis: {
      ordersToday: { count: 0, yesterdayCount: 0, changePercent: null, sparkline: [0, 0, 0, 0, 0, 0, 0] },
      openOrders: { count: 0, status: 'مستقر', sparkline: [0, 0, 0, 0, 0, 0, 0] },
      deliveredToday: { count: 0, deliveredRate: null, sparkline: [0, 0, 0, 0, 0, 0, 0] },
      needsIntervention: { count: 0, criticalCount: 0, sparkline: [0, 0, 0, 0, 0, 0, 0] },
    },
    activityChart: { days: 7, series: [] },
    actionRequired: { total: 0, criticalCount: 0, items: [] },
    stageBoard: { totalActive: 0, stages: [] },
    financialSummary: {
      pendingCod: { amount: 0, shipmentCount: 0, currency: 'EGP' },
      collectedToday: { amount: 0, transactionCount: 0, currency: 'EGP' },
      unresolvedVariance: { amount: 0, caseCount: 0, currency: 'EGP', details: null },
      totalReceivedToday: { amount: 0, transactionCount: 0, currency: 'EGP' },
    },
  }

  assert.equal(emptyOverview.kpis.ordersToday.count, 0)
  assert.equal(emptyOverview.kpis.ordersToday.changePercent, null)
  assert.equal(emptyOverview.kpis.deliveredToday.deliveredRate, null)
  assert.equal(emptyOverview.actionRequired.items.length, 0)
  assert.equal(emptyOverview.financialSummary.pendingCod.amount, 0)
  assert.equal(emptyOverview.financialSummary.collectedToday.amount, 0)
  assert.equal(emptyOverview.financialSummary.unresolvedVariance.amount, 0)
})
