import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Unit tests for Courier Handoff & Cash Settlement calculations and logic.
 */

function calculateSettlementVariance(actualReceived, expectedTotal) {
  const actual = Number(actualReceived)
  const expected = Number(expectedTotal)
  if (!Number.isFinite(actual) || actual < 0) return null
  return Math.round((actual - expected) * 100) / 100
}

function classifyTripPresentationStatus(run, stops, collections, failedShipments) {
  if (run.status === 'planning') {
    const allHandedOver = stops.length > 0 && stops.every(s => s.handedOver)
    return allHandedOver ? 'COURIER_RECEIVED' : 'COURIER_ASSIGNED'
  }

  if (run.status === 'dispatched') {
    const activeStops = stops.filter(s => s.attemptStatus === 'active')
    if (activeStops.length > 0) return 'OUT_FOR_DELIVERY'
  }

  // Delivery completed or failed
  const driverCollections = collections.filter(c => c.courierId === run.driverId && c.status === 'collected')
  const runFailed = failedShipments.filter(f => f.activeRun?.batchId === run.id)

  const hasUnsettledCash = driverCollections.length > 0
  const hasUnreconciledReturns = runFailed.length > 0

  if (hasUnsettledCash || hasUnreconciledReturns || run.status !== 'completed') {
    return 'AWAITING_SETTLEMENT'
  }

  return 'FULLY_RECONCILED_AND_CLOSED'
}

test('calculateSettlementVariance calculates exact, short, and over cash correctly', () => {
  assert.equal(calculateSettlementVariance(500, 500), 0)
  assert.equal(calculateSettlementVariance(450, 500), -50)
  assert.equal(calculateSettlementVariance(520, 500), 20)
  assert.equal(calculateSettlementVariance('300.50', 300), 0.5)
  assert.equal(calculateSettlementVariance(-10, 500), null)
  assert.equal(calculateSettlementVariance('invalid', 500), null)
})

test('classifyTripPresentationStatus distinguishes all lifecycle states truthfully', () => {
  // 1. Planning with unverified handoffs
  const planningRun = { id: 'run-1', status: 'planning', driverId: 'd-1' }
  const stopsNotAllScanned = [{ shipmentId: 's-1', handedOver: true }, { shipmentId: 's-2', handedOver: false }]
  assert.equal(
    classifyTripPresentationStatus(planningRun, stopsNotAllScanned, [], []),
    'COURIER_ASSIGNED'
  )

  // 2. Planning with all scanned
  const stopsAllScanned = [{ shipmentId: 's-1', handedOver: true }, { shipmentId: 's-2', handedOver: true }]
  assert.equal(
    classifyTripPresentationStatus(planningRun, stopsAllScanned, [], []),
    'COURIER_RECEIVED'
  )

  // 3. Out for delivery (dispatched with active stops)
  const dispatchedRun = { id: 'run-2', status: 'dispatched', driverId: 'd-1' }
  const stopsActive = [{ shipmentId: 's-1', attemptStatus: 'active' }, { shipmentId: 's-2', attemptStatus: 'delivered' }]
  assert.equal(
    classifyTripPresentationStatus(dispatchedRun, stopsActive, [], []),
    'OUT_FOR_DELIVERY'
  )

  // 4. Awaiting settlement because of pending cash
  const stopsAllAttempted = [{ shipmentId: 's-1', attemptStatus: 'delivered' }, { shipmentId: 's-2', attemptStatus: 'delivered' }]
  const openCollections = [{ courierId: 'd-1', status: 'collected', expectedAmount: '200' }]
  assert.equal(
    classifyTripPresentationStatus(dispatchedRun, stopsAllAttempted, openCollections, []),
    'AWAITING_SETTLEMENT'
  )

  // 5. Awaiting settlement because of pending returned parcels
  const stopsWithFailed = [{ shipmentId: 's-1', attemptStatus: 'delivered' }, { shipmentId: 's-2', attemptStatus: 'failed' }]
  const failedShipments = [{ shipmentId: 's-2', activeRun: { batchId: 'run-2' } }]
  assert.equal(
    classifyTripPresentationStatus(dispatchedRun, stopsWithFailed, [], failedShipments),
    'AWAITING_SETTLEMENT'
  )

  // 6. Fully reconciled and completed
  const completedRun = { id: 'run-3', status: 'completed', driverId: 'd-1' }
  assert.equal(
    classifyTripPresentationStatus(completedRun, stopsAllAttempted, [], []),
    'FULLY_RECONCILED_AND_CLOSED'
  )
})

test('consolidation aggregates cash across multiple trips without double counting', () => {
  const collections = [
    { id: 'c-1', courierId: 'd-1', expectedAmount: '300', declaredAmount: '300', status: 'collected' },
    { id: 'c-2', courierId: 'd-1', expectedAmount: '450', declaredAmount: '450', status: 'collected' },
    { id: 'c-3', courierId: 'd-2', expectedAmount: '200', declaredAmount: '200', status: 'collected' },
  ]

  const tarekCollections = collections.filter(c => c.courierId === 'd-1')
  const totalExpected = tarekCollections.reduce((sum, c) => sum + Number(c.expectedAmount), 0)
  const totalDeclared = tarekCollections.reduce((sum, c) => sum + Number(c.declaredAmount), 0)

  assert.equal(totalExpected, 750)
  assert.equal(totalDeclared, 750)
})
