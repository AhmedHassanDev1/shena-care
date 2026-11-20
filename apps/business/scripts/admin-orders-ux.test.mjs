import test from 'node:test'
import assert from 'node:assert/strict'

// Helper mirroring skuText in order details
function skuText(sku, fallbackName, fallbackVariant) {
  if (sku) {
    return `${sku.productName}${sku.variantName ? ` · ${sku.variantName}` : ''}`
  }
  const parts = [fallbackName, fallbackVariant].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

// Helper mirroring financial calculations
function computeFinancials(order) {
  const itemsSubtotal = order.subtotal ?? order.items.reduce((sum, item) => sum + (item.lineTotal ?? item.price * item.quantity), 0)
  const effectiveOrderDiscount = Math.max(0, Math.round(((itemsSubtotal + order.shippingFee) - order.totalAmount) * 100) / 100)
  return { itemsSubtotal, effectiveOrderDiscount }
}

// Helper mirroring status group mapping in orders list
function getActiveGroup(status) {
  if (['placed', 'confirmed', 'packing'].includes(status)) return 'active'
  if (['cancelled', 'returned'].includes(status)) return 'terminal'
  return status
}

// Helper mirroring exceptions categorization
function categorizeExceptions(data) {
  const largeCashVariances = [
    ...(data?.cashVariances?.short?.items ?? []).filter((i) => i.severity === 'large'),
    ...(data?.cashVariances?.over?.items ?? []).filter((i) => i.severity === 'large'),
  ]
  const largeRoundVariances = (data?.roundVariances?.items ?? []).filter((r) => r.severity === 'large')
  const unsettledRoundsCount = data?.unsettledRounds?.items?.length ?? 0
  const criticalCases = (data?.openCases?.items ?? []).filter((c) => c.priority === 'critical')

  const criticalTotal =
    largeCashVariances.length +
    largeRoundVariances.length +
    unsettledRoundsCount +
    criticalCases.length

  const unansweredPOs = data?.supplierResponses?.unanswered ?? []
  const unopenedPOs = data?.supplierResponses?.unopened ?? []
  const allSupplierWaits = [...unansweredPOs, ...unopenedPOs]
  const distributionItems = data?.distributionRequired?.items ?? []
  const supplyShortageItems = data?.supplyActionRequired?.items ?? []
  const customerDecisionItems = data?.customerDecisionsPending?.items ?? []
  const failedDeliveryItems = data?.failedDeliveries?.items ?? []
  const standardSupportCases = (data?.openCases?.items ?? []).filter((c) => c.priority !== 'critical')
  const lateOrdersItems = data?.lateOrders?.items ?? []

  const operationalTotal =
    allSupplierWaits.length +
    distributionItems.length +
    supplyShortageItems.length +
    customerDecisionItems.length +
    failedDeliveryItems.length +
    standardSupportCases.length +
    lateOrdersItems.length

  const deliveredUnsettledCount = data?.deliveredUnsettled?.total ?? 0
  const deadEventsCount = data?.eventFailures?.totalDead ?? 0
  const failedEventsCount = data?.eventFailures?.totalFailed ?? 0

  const hasAnyIssues = criticalTotal > 0 || operationalTotal > 0 || deliveredUnsettledCount > 0 || deadEventsCount > 0

  return {
    criticalTotal,
    operationalTotal,
    deliveredUnsettledCount,
    deadEventsCount,
    failedEventsCount,
    hasAnyIssues,
    largeCashVariances,
    largeRoundVariances,
    unsettledRoundsCount,
    criticalCases,
    lateOrdersItems,
  }
}

test('skuText resolves live catalog SKU or falls back cleanly to order snapshots', () => {
  // 1. Live catalog label present
  const liveSku = { productName: 'غسول سيرافي', variantName: '236 مل', skuCode: 'SKU-100', brandName: 'CeraVe', barcode: '123' }
  assert.equal(skuText(liveSku, 'قديم', 'قديم'), 'غسول سيرافي · 236 مل')

  // 2. Live catalog missing, but snapshot has product & variant
  assert.equal(skuText(null, 'مرطب لاروش بوزيه', '40 مل'), 'مرطب لاروش بوزيه · 40 مل')

  // 3. Live catalog missing, snapshot only has product name
  assert.equal(skuText(null, 'شامبو فيشي', null), 'شامبو فيشي')

  // 4. Everything missing
  assert.equal(skuText(null, null, null), '—')
})

test('financial calculations correctly identify promo discounts without inventing math', () => {
  // Case A: 300 EGP products + 30 EGP shipping, promo voucher of 50 EGP -> total 280 EGP
  const orderWithVoucher = {
    subtotal: 300,
    shippingFee: 30,
    totalAmount: 280,
    items: [{ id: '1', price: 150, quantity: 2, lineTotal: 300 }],
  }
  const f1 = computeFinancials(orderWithVoucher)
  assert.equal(f1.itemsSubtotal, 300)
  assert.equal(f1.effectiveOrderDiscount, 50)

  // Case B: Regular order without discount
  const regularOrder = {
    subtotal: 200,
    shippingFee: 25,
    totalAmount: 225,
    items: [{ id: '1', price: 100, quantity: 2, lineTotal: 200 }],
  }
  const f2 = computeFinancials(regularOrder)
  assert.equal(f2.itemsSubtotal, 200)
  assert.equal(f2.effectiveOrderDiscount, 0)

  // Case C: Subtotal missing from header, derived from active items lineTotal
  const orderWithMissingSubtotal = {
    subtotal: null,
    shippingFee: 20,
    totalAmount: 180,
    items: [
      { id: '1', price: 100, quantity: 1, lineTotal: 100 },
      { id: '2', price: 50, quantity: 2, discountAmount: 20, lineTotal: 80 },
    ],
  }
  const f3 = computeFinancials(orderWithMissingSubtotal)
  assert.equal(f3.itemsSubtotal, 180)
  assert.equal(f3.effectiveOrderDiscount, 20)
})

test('orders list status mapping properly clusters granular statuses into semantic groups', () => {
  assert.equal(getActiveGroup('placed'), 'active')
  assert.equal(getActiveGroup('confirmed'), 'active')
  assert.equal(getActiveGroup('packing'), 'active')
  assert.equal(getActiveGroup('shipped'), 'shipped')
  assert.equal(getActiveGroup('delivered'), 'delivered')
  assert.equal(getActiveGroup('cancelled'), 'terminal')
  assert.equal(getActiveGroup('returned'), 'terminal')
  assert.equal(getActiveGroup(''), '')
})

test('exceptions categorization isolates critical escalations from operational queues and handles dead data', () => {
  const mockQueue = {
    cashVariances: {
      short: { total: 2, items: [{ orderId: '1', orderNumber: 'ORD-1', variance: '-50.00', severity: 'large' }, { orderId: '2', orderNumber: 'ORD-2', variance: '-5.00', severity: 'small' }] },
      over: { total: 0, items: [] },
    },
    roundVariances: {
      total: 1,
      items: [{ batchId: 'b1', reference: 'REF-1', expectedTotal: '1000', countedTotal: '950', variance: '-50.00', severity: 'large', settledAt: '2026-11-20' }],
    },
    unsettledRounds: {
      total: 1,
      items: [{ courierId: 'c1', locationId: 'l1', orders: 5, expectedTotal: '2500', declaredTotal: '2500', oldestDeclaredAt: '2026-11-19T10:00:00Z' }],
    },
    openCases: {
      total: 2,
      items: [
        { id: 'case-1', title: 'خسارة هامش سلبي', priority: 'critical', orderId: '1', createdAt: '2026-11-20' },
        { id: 'case-2', title: 'استفسار عميل', priority: 'medium', orderId: '2', createdAt: '2026-11-20' },
      ],
    },
    lateOrders: {
      total: 2,
      items: [
        { orderId: 'o1', orderNumber: 'ORD-10', promisedDate: '2026-11-18', daysLate: 2 },
        { orderId: 'o2', orderNumber: 'ORD-11', promisedDate: '2026-11-20', daysLate: 0 },
      ],
    },
    supplierResponses: {
      unanswered: [{ purchaseOrderId: 'po-1', supplierName: 'مورد أ', waitedMinutes: 150, opened: true, lineCount: 3, totalCost: 500, currency: 'EGP' }],
      unopened: [{ purchaseOrderId: 'po-2', supplierName: 'مورد ب', waitedMinutes: 45, opened: false, lineCount: 1, totalCost: 200, currency: 'EGP' }],
    },
    distributionRequired: {
      total: 1,
      items: [{ purchaseOrderId: 'po-3', lineId: 'l1', requestedQuantity: 10, confirmedQuantity: 5 }],
    },
    supplyActionRequired: {
      total: 1,
      items: [{ orderId: 'o3', orderNumber: 'ORD-12', category: 'SOURCE_EXHAUSTED', unresolvedQuantity: 2 }],
    },
    customerDecisionsPending: {
      total: 1,
      items: [{ orderId: 'o4', orderNumber: 'ORD-13', reason: 'مطلوب بديل', unresolvedQuantity: 1 }],
    },
    failedDeliveries: {
      total: 1,
      items: [{ orderId: 'o5', orderNumber: 'ORD-14', reasonCode: 'CUSTOMER_UNREACHABLE', failedAt: '2026-11-19', returnDue: true }],
    },
    deliveredUnsettled: {
      total: 3,
      items: [],
    },
    eventFailures: {
      failed: [],
      dead: [{ id: 'ev-1', eventType: 'order.created', consumer: 'fulfillment', aggregateId: '1', attempts: 5, lastError: 'timeout', nextAttemptAt: null }],
      totalFailed: 0,
      totalDead: 1,
    },
  }

  const result = categorizeExceptions(mockQueue)

  // 1. Critical escalations count (strictly executive decisions):
  // - 1 large cash variance
  // - 1 large round variance
  // - 1 unsettled round > 12h
  // - 1 critical support case
  // Total = 4
  assert.equal(result.criticalTotal, 4)

  // 2. Operational count (handled in Hub, Sourcing, Delivery, Support):
  // - 2 supplier waits (1 unanswered + 1 unopened)
  // - 1 distribution required
  // - 1 supply action required
  // - 1 customer decision pending
  // - 1 failed delivery
  // - 1 standard support case (medium priority)
  // - 2 late orders in Hub
  // Total = 9
  assert.equal(result.operationalTotal, 9)

  // 3. Unused monitoring data captured:
  assert.equal(result.deliveredUnsettledCount, 3)
  assert.equal(result.deadEventsCount, 1)
  assert.equal(result.hasAnyIssues, true)
})

test('empty exception queue yields unified zero-issue state', () => {
  const emptyQueue = {
    cashVariances: { short: { total: 0, items: [] }, over: { total: 0, items: [] } },
    roundVariances: { total: 0, items: [] },
    unsettledRounds: { total: 0, items: [] },
    openCases: { total: 0, items: [] },
    lateOrders: { total: 0, items: [] },
    supplierResponses: { unanswered: [], unopened: [] },
    distributionRequired: { total: 0, items: [] },
    supplyActionRequired: { total: 0, items: [] },
    customerDecisionsPending: { total: 0, items: [] },
    failedDeliveries: { total: 0, items: [] },
    deliveredUnsettled: { total: 0, items: [] },
    eventFailures: { failed: [], dead: [], totalFailed: 0, totalDead: 0 },
  }

  const result = categorizeExceptions(emptyQueue)
  assert.equal(result.criticalTotal, 0)
  assert.equal(result.operationalTotal, 0)
  assert.equal(result.deliveredUnsettledCount, 0)
  assert.equal(result.deadEventsCount, 0)
  assert.equal(result.hasAnyIssues, false)
})
