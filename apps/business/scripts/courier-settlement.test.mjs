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

/**
 * A trip's settlement presentation comes from the server's run settlement state (stops + the cash of the delivered orders), never from
 * "no unsettled collections found": an empty trip, a counted trip and a prepaid trip all have zero open collections but are not the same thing.
 */
function classifyTripPresentationStatus(run, stops) {
  if (run.status === 'planning') {
    const allHandedOver = stops.length > 0 && stops.every(s => s.handedOver)
    return allHandedOver ? 'COURIER_RECEIVED' : 'COURIER_ASSIGNED'
  }

  if (run.status === 'dispatched') {
    const activeStops = stops.filter(s => s.attemptStatus === 'active')
    if (activeStops.length > 0) return 'OUT_FOR_DELIVERY'
  }

  const state = run.settlement && run.settlement.state
  if (run.status === 'completed' || state === 'completed') return 'FULLY_RECONCILED_AND_CLOSED'
  if (state === 'settled') return 'READY_TO_CLOSE'
  return 'AWAITING_SETTLEMENT' // pending, reconciliation_required, or unknown: never presented as settled
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
  const planningRun = { id: 'run-1', status: 'planning', driverId: 'd-1' }
  assert.equal(classifyTripPresentationStatus(planningRun, [{ handedOver: true }, { handedOver: false }]), 'COURIER_ASSIGNED')
  assert.equal(classifyTripPresentationStatus(planningRun, [{ handedOver: true }, { handedOver: true }]), 'COURIER_RECEIVED')

  const onTheRoad = { id: 'run-2', status: 'dispatched', driverId: 'd-1' }
  assert.equal(classifyTripPresentationStatus(onTheRoad, [{ attemptStatus: 'active' }, { attemptStatus: 'delivered' }]), 'OUT_FOR_DELIVERY')

  const attempted = [{ attemptStatus: 'delivered' }, { attemptStatus: 'delivered' }]
  const withState = (state) => ({ id: 'run-3', status: 'dispatched', driverId: 'd-1', settlement: { state } })
  // Cash waiting for the count, or a failed parcel still with the courier: not settled.
  assert.equal(classifyTripPresentationStatus(withState('pending'), attempted), 'AWAITING_SETTLEMENT')
  assert.equal(classifyTripPresentationStatus(withState('reconciliation_required'), attempted), 'AWAITING_SETTLEMENT')
  // A trip without a server answer, or an empty trip, is never presented as settled.
  assert.equal(classifyTripPresentationStatus({ id: 'run-4', status: 'dispatched', driverId: 'd-1' }, attempted), 'AWAITING_SETTLEMENT')
  assert.equal(classifyTripPresentationStatus(withState('pending'), []), 'AWAITING_SETTLEMENT')
  // Settled (counted, or a valid zero-COD delivery) is ready to close; only a closed run is closed.
  assert.equal(classifyTripPresentationStatus(withState('settled'), attempted), 'READY_TO_CLOSE')
  assert.equal(classifyTripPresentationStatus({ id: 'run-5', status: 'completed', driverId: 'd-1', settlement: { state: 'completed' } }, attempted), 'FULLY_RECONCILED_AND_CLOSED')
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
