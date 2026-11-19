import { assessRunSettlement, runCodExposure, RunCollectionFact, RunStopFact } from '../../src/modules/fulfillment/services/run-settlement';

const stop = (n: number, stopStatus: string, shipmentStatus: string): RunStopFact => ({ stopStatus, shipmentStatus, shipmentId: `s${n}`, orderId: `o${n}` });
const batch = { id: 'b1', reference: 'CNT-1', settledAt: new Date('2026-11-19T10:00:00Z'), totalExpected: 300, totalCollected: 290 };
const cash = (n: number, status: string, extra: Partial<RunCollectionFact> = {}): RunCollectionFact => ({
  orderId: `o${n}`, status, expectedAmount: 300, declaredAmount: status === 'expected' ? null : 300, countedAmount: null, settlementBatchId: null, ...extra,
});
const counted = (n: number, status = 'short') => cash(n, status, { countedAmount: 300, settlementBatchId: 'b1', batch });

describe('run settlement assessment', () => {
  it('an empty run is never settled or completable', () => {
    const empty = assessRunSettlement({ runStatus: 'dispatched', stops: [], collections: [] });
    expect(empty.state).toBe('pending');
    expect(empty.canComplete).toBe(false);
    expect(empty.canSettleCash).toBe(false);
    expect(empty.blockers.map(b => b.code)).toEqual(['NO_STOPS']);
  });

  it('a run whose parcels have no outcome yet is pending, not settled', () => {
    const onRoad = assessRunSettlement({ runStatus: 'dispatched', stops: [stop(1, 'active', 'out_for_delivery')], collections: [cash(1, 'expected')] });
    expect(onRoad).toMatchObject({ state: 'pending', canComplete: false });
    expect(onRoad.blockers.map(b => b.code)).toEqual(expect.arrayContaining(['NO_OUTCOMES', 'STOPS_IN_TRANSIT']));
  });

  it('delivered COD with declared, uncounted cash is pending and can be counted but not completed', () => {
    const a = assessRunSettlement({ runStatus: 'dispatched', stops: [stop(1, 'delivered', 'delivered')], collections: [cash(1, 'collected')] });
    expect(a).toMatchObject({ state: 'pending', canSettleCash: true, canComplete: false });
    expect(a.cash).toMatchObject({ codOrders: 1, awaitingCount: 1, expectedTotal: 300, declaredTotal: 300, awaitingCountOrderIds: ['o1'], variance: null });
    expect(a.blockers).toEqual([{ code: 'CASH_AWAITING_COUNT', count: 1 }]);
  });

  it('a counted run is settled and completable; the variance comes from the cashier count, not the declaration', () => {
    const a = assessRunSettlement({ runStatus: 'dispatched', stops: [stop(1, 'delivered', 'delivered')], collections: [counted(1)] });
    expect(a).toMatchObject({ state: 'settled', canComplete: true, canSettleCash: false, blockers: [] });
    expect(a.cash).toMatchObject({ counted: 1, countedTotal: 290, expectedTotal: 300, variance: -10 });
    expect(a.settlements).toHaveLength(1);
  });

  it('a valid zero-COD run (prepaid parcels delivered) is settled without any cash row', () => {
    const a = assessRunSettlement({ runStatus: 'dispatched', stops: [stop(1, 'delivered', 'delivered'), stop(2, 'delivered', 'delivered')], collections: [] });
    expect(a).toMatchObject({ state: 'settled', canComplete: true });
    expect(a.cash).toMatchObject({ zeroCodDeliveries: 2, codOrders: 0, variance: null });
  });

  it('a failed parcel still in the courier\'s hands needs reconciliation and blocks completion even when the cash is counted', () => {
    const a = assessRunSettlement({ runStatus: 'dispatched', stops: [stop(1, 'delivered', 'delivered'), stop(2, 'active', 'failed')], collections: [counted(1)] });
    expect(a).toMatchObject({ state: 'reconciliation_required', canComplete: false, pendingReturnShipmentIds: ['s2'] });
    expect(a.blockers.map(b => b.code)).toEqual(['PENDING_RETURNS']);
  });

  it('a run whose only outcome is a returned parcel (nothing delivered, nothing owed) is settled and completable', () => {
    const a = assessRunSettlement({ runStatus: 'dispatched', stops: [stop(1, 'failed', 'packed')], collections: [cash(1, 'voided')] });
    expect(a).toMatchObject({ state: 'settled', canComplete: true });
    expect(a.stops).toMatchObject({ delivered: 0, returnedToHub: 1 });
  });

  it('delivered COD whose cash was never declared needs reconciliation', () => {
    const a = assessRunSettlement({ runStatus: 'dispatched', stops: [stop(1, 'delivered', 'delivered')], collections: [cash(1, 'expected')] });
    expect(a).toMatchObject({ state: 'reconciliation_required', canComplete: false, canSettleCash: false });
  });

  it('only parcels delivered on this run carry its cash: a failed attempt later delivered elsewhere is not this run\'s cash', () => {
    const a = assessRunSettlement({ runStatus: 'dispatched', stops: [stop(1, 'failed', 'delivered')], collections: [cash(1, 'collected')] });
    expect(a.cash.awaitingCount).toBe(0);
    expect(a).toMatchObject({ state: 'settled', canComplete: true });
  });

  it('a completed run reports completed and cannot be completed again', () => {
    const a = assessRunSettlement({ runStatus: 'completed', stops: [stop(1, 'delivered', 'delivered')], collections: [counted(1, 'settled')] });
    expect(a).toMatchObject({ state: 'completed', canComplete: false });
  });

  it('disputed cash needs reconciliation', () => {
    const a = assessRunSettlement({ runStatus: 'dispatched', stops: [stop(1, 'delivered', 'delivered')], collections: [cash(1, 'disputed')] });
    expect(a).toMatchObject({ state: 'reconciliation_required', canComplete: false });
  });
});

describe('run COD exposure', () => {
  it('sums the expected cash of every COD parcel still expected back, on the road or delivered', () => {
    const e = runCodExposure(
      [stop(1, 'active', 'out_for_delivery'), stop(2, 'delivered', 'delivered'), stop(3, 'active', 'out_for_delivery')],
      [cash(1, 'expected'), cash(2, 'collected'), cash(3, 'voided')],
    );
    expect(e).toEqual({ orders: 2, expectedTotal: 600 });
  });

  it('drops failed, returned and cancelled parcels and prepaid orders without a collection', () => {
    const e = runCodExposure(
      [stop(1, 'failed', 'failed'), stop(2, 'returned', 'returned'), stop(3, 'active', 'cancelled'), stop(4, 'delivered', 'delivered'), stop(5, 'delivered', 'delivered')],
      [cash(1, 'expected'), cash(2, 'expected'), cash(3, 'expected'), cash(4, 'collected')],
    );
    expect(e).toEqual({ orders: 1, expectedTotal: 300 });
  });

  it('an empty run expects nothing', () => {
    expect(runCodExposure([], [])).toEqual({ orders: 0, expectedTotal: 0 });
  });
});
