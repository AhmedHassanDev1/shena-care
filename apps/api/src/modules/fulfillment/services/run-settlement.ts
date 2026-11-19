/**
 * Settlement position of one delivery run, derived from facts the backend already owns: the run's stops (Fulfillment) and the
 * cash collections of the orders those stops delivered (Ordering). Pure and side-effect free so the hub's queue, the settlement
 * drawer and the "complete trip" gate all read the same answer instead of each screen re-deriving it.
 *
 * States (a run is exactly one of them):
 *  - pending                 – parcels still on the road, cash declared but not yet counted, or nothing has happened yet
 *  - reconciliation_required – something needs a person: a failed parcel still in the courier's hands, cash that was never
 *                              declared, or a disputed collection
 *  - settled                 – every delivery is accounted for (cash counted or none was due) and every returned parcel is
 *                              back at the hub; the run may be completed
 *  - completed               – the run is closed
 */
export type RunSettlementState = 'pending' | 'reconciliation_required' | 'settled' | 'completed';

export type RunBlockerCode =
  | 'NO_STOPS'            // the run carries no parcels at all
  | 'NO_OUTCOMES'         // no parcel was delivered or returned yet, so there is nothing to settle
  | 'STOPS_IN_TRANSIT'    // parcels are still waiting for a delivery outcome
  | 'PENDING_RETURNS'     // failed parcels not yet received back at the hub
  | 'CASH_UNDECLARED'     // delivered COD order whose cash the courier never declared
  | 'CASH_AWAITING_COUNT' // declared cash the cashier has not counted
  | 'CASH_DISPUTED';      // a collection marked disputed

export interface RunStopFact {
  stopStatus: string;      // active | delivered | failed | returned
  shipmentStatus: string;
  shipmentId: string;
  orderId: string;
}

export interface RunCollectionFact {
  orderId: string;
  status: string;          // expected | collected | settled | short | over | disputed | voided
  expectedAmount: number;
  declaredAmount: number | null;
  countedAmount: number | null;
  settlementBatchId: string | null;
  /** The counted round this collection belongs to: its cash totals are what the cashier physically counted. */
  batch?: { id: string; reference: string; settledAt: Date; totalExpected: number; totalCollected: number } | null;
}

export interface RunSettlementAssessment {
  state: RunSettlementState;
  stops: { total: number; delivered: number; inTransit: number; pendingReturns: number; returnedToHub: number; cancelled: number };
  cash: {
    /** Delivered orders whose payment was already made online / nothing is owed at the door. */
    zeroCodDeliveries: number;
    /** Delivered orders with a COD obligation. */
    codOrders: number;
    awaitingDeclaration: number;
    awaitingCount: number;
    counted: number;
    disputed: number;
    expectedTotal: number;
    declaredTotal: number;
    countedTotal: number;
    /** Counted minus expected, only once every COD order of the run has been counted. */
    variance: number | null;
    awaitingCountOrderIds: string[];
  };
  /** The counted rounds that settled this run's cash (usually one), each with its own variance. */
  settlements: Array<{ id: string; reference: string; settledAt: Date; expectedTotal: number; countedTotal: number; variance: number }>;
  pendingReturnShipmentIds: string[];
  blockers: Array<{ code: RunBlockerCode; count: number }>;
  canSettleCash: boolean;
  canComplete: boolean;
}

const COUNTED = new Set(['settled', 'short', 'over']);
const round2 = (value: number) => Math.round(value * 100) / 100;

export function assessRunSettlement(input: { runStatus: string; stops: RunStopFact[]; collections: RunCollectionFact[] }): RunSettlementAssessment {
  const byOrder = new Map(input.collections.map(c => [c.orderId, c]));

  let delivered = 0; let inTransit = 0; let returnedToHub = 0; let cancelled = 0;
  const pendingReturnShipmentIds: string[] = [];
  const deliveredOrderIds: string[] = [];

  for (const stop of input.stops) {
    const shipment = stop.shipmentStatus;
    if (stop.stopStatus === 'delivered' || (stop.stopStatus === 'active' && shipment === 'delivered')) {
      delivered++; deliveredOrderIds.push(stop.orderId);
    } else if (stop.stopStatus === 'failed' || stop.stopStatus === 'returned' || (stop.stopStatus === 'active' && shipment === 'returned')) {
      returnedToHub++; // the attempt is closed: the parcel is back at the hub or returned
    } else if (stop.stopStatus === 'active' && shipment === 'cancelled') {
      cancelled++;
    } else if (stop.stopStatus === 'active' && shipment === 'failed') {
      pendingReturnShipmentIds.push(stop.shipmentId); // failed, still in the courier's hands
    } else {
      inTransit++;
    }
  }

  let zeroCodDeliveries = 0; let codOrders = 0; let awaitingDeclaration = 0; let awaitingCount = 0; let counted = 0; let disputed = 0;
  let expectedTotal = 0; let declaredTotal = 0; let countedTotal = 0;
  const awaitingCountOrderIds: string[] = [];
  const batches = new Map<string, NonNullable<RunCollectionFact['batch']>>();
  for (const orderId of deliveredOrderIds) {
    const collection = byOrder.get(orderId);
    if (!collection || collection.status === 'voided') { zeroCodDeliveries++; continue; }
    codOrders++;
    expectedTotal += collection.expectedAmount;
    declaredTotal += collection.declaredAmount ?? 0;
    if (COUNTED.has(collection.status) && collection.settlementBatchId) {
      counted++;
      if (collection.batch) batches.set(collection.batch.id, collection.batch);
    }
    else if (collection.status === 'disputed') disputed++;
    else if (collection.status === 'collected') { awaitingCount++; awaitingCountOrderIds.push(orderId); }
    else awaitingDeclaration++; // expected: delivered but the courier never declared cash
  }

  // The cashier's physical count is the batch total; a line only carries the courier's declaration.
  for (const batch of batches.values()) { countedTotal += batch.totalCollected; }
  const settlements = [...batches.values()].map(b => ({ id: b.id, reference: b.reference, settledAt: b.settledAt, expectedTotal: round2(b.totalExpected), countedTotal: round2(b.totalCollected), variance: round2(b.totalCollected - b.totalExpected) }))
    .sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());

  const hasOutcome = delivered + returnedToHub + pendingReturnShipmentIds.length > 0;
  const blockers: RunSettlementAssessment['blockers'] = [];
  if (input.stops.length === 0) blockers.push({ code: 'NO_STOPS', count: 0 });
  else if (!hasOutcome) blockers.push({ code: 'NO_OUTCOMES', count: input.stops.length });
  if (inTransit > 0) blockers.push({ code: 'STOPS_IN_TRANSIT', count: inTransit });
  if (pendingReturnShipmentIds.length > 0) blockers.push({ code: 'PENDING_RETURNS', count: pendingReturnShipmentIds.length });
  if (awaitingDeclaration > 0) blockers.push({ code: 'CASH_UNDECLARED', count: awaitingDeclaration });
  if (awaitingCount > 0) blockers.push({ code: 'CASH_AWAITING_COUNT', count: awaitingCount });
  if (disputed > 0) blockers.push({ code: 'CASH_DISPUTED', count: disputed });

  let state: RunSettlementState;
  if (input.runStatus === 'completed') state = 'completed';
  else if (pendingReturnShipmentIds.length > 0 || awaitingDeclaration > 0 || disputed > 0) state = 'reconciliation_required';
  else if (blockers.length > 0) state = 'pending';
  else state = 'settled';

  const dispatched = input.runStatus === 'dispatched';
  return {
    state,
    stops: { total: input.stops.length, delivered, inTransit, pendingReturns: pendingReturnShipmentIds.length, returnedToHub, cancelled },
    cash: {
      zeroCodDeliveries, codOrders, awaitingDeclaration, awaitingCount, counted, disputed,
      expectedTotal: round2(expectedTotal), declaredTotal: round2(declaredTotal), countedTotal: round2(countedTotal),
      variance: codOrders > 0 && counted === codOrders && batches.size > 0 ? round2(settlements.reduce((sum, b) => sum + b.variance, 0)) : null,
      awaitingCountOrderIds,
    },
    settlements,
    pendingReturnShipmentIds,
    blockers,
    canSettleCash: (dispatched || input.runStatus === 'completed') && awaitingCount > 0,
    canComplete: dispatched && blockers.length === 0,
  };
}
