/**
 * Pure helpers for the Hub trip desk (/hub/dispatch). No business rule lives here: the backend owns settlement state, expected
 * COD, custody and the complete gate. This file only shapes what the server already answered into what a card shows.
 */

export type SettlementState = 'pending' | 'reconciliation_required' | 'settled' | 'completed'

export interface RunBlocker {
  code: string
  count: number
}

export interface RunSettlementSummary {
  state: SettlementState
  stops: { total: number; delivered: number; inTransit: number; pendingReturns: number; returnedToHub: number; cancelled: number }
  cash: {
    zeroCodDeliveries: number
    codOrders: number
    awaitingDeclaration: number
    awaitingCount: number
    counted: number
    disputed: number
    expectedTotal: number
    declaredTotal: number
    countedTotal: number
    variance: number | null
  }
  blockers: RunBlocker[]
  canSettleCash: boolean
  canComplete: boolean
}

/** One row of the hub run list (`GET /fulfillment/locations/:id/runs`). */
export interface Run {
  id: string
  status: string
  driverId: string | null
  plannedAt: string | null
  dispatchedAt: string | null
  completedAt: string | null
  stops: number
  stopOrderIds?: string[]
  attempts: Record<string, number>
  /** Stops still waiting for a delivery outcome (a failed parcel in the courier's hands no longer counts). */
  toAttempt?: number
  /** Cash the whole trip should bring back, parcels still on the road included (server-calculated). */
  cod?: { orders: number; expectedTotal: number }
  settlement?: RunSettlementSummary
}

/** The trip reference shown to people. Derived from the trip's own id, so it is unique and needs no second accounting record. */
export function tripRef(id: string): string {
  return `TRP-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

/** What a trip card shows while the trip is out or being settled. All numbers come from the server's settlement block. */
export function tripCounts(run: Pick<Run, 'stops' | 'toAttempt' | 'settlement'>): {
  total: number
  delivered: number
  failed: number
  remaining: number
} {
  const s = run.settlement?.stops
  if (!s) return { total: run.stops, delivered: 0, failed: 0, remaining: run.toAttempt ?? run.stops }
  return {
    total: s.total,
    delivered: s.delivered,
    failed: s.pendingReturns + s.returnedToHub,
    remaining: s.inTransit,
  }
}

export type CashDifference =
  | { kind: 'empty' }
  | { kind: 'matched'; amount: 0 }
  | { kind: 'shortage'; amount: number }
  | { kind: 'surplus'; amount: number }

const round2 = (n: number) => Math.round(n * 100) / 100

/** Reads a money field typed on an Arabic or English keyboard ("١٢٣٫٥", "1,234.50"). Returns null when it is not a valid amount. */
export function parseAmount(input: string): number | null {
  const western = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫]/g, '.')
    .replace(/[٬,\s]/g, '')
  if (western === '' || !/^\d+(\.\d{1,2})?$/.test(western)) return null
  const n = Number(western)
  return Number.isFinite(n) ? round2(n) : null
}

/** Difference between the cash actually received and what the backend expects. Cents-exact. */
export function cashDifference(expected: number, received: number | null): CashDifference {
  if (received === null) return { kind: 'empty' }
  const diff = round2(received - expected)
  if (diff === 0) return { kind: 'matched', amount: 0 }
  return diff < 0 ? { kind: 'shortage', amount: Math.abs(diff) } : { kind: 'surplus', amount: diff }
}

/** "مشوار 2 من 3" per courier and day, so a courier with several trips can be told apart without reading ids. */
export function tripSequence(runs: Array<Pick<Run, 'id' | 'driverId' | 'plannedAt'>>): Map<string, { n: number; of: number }> {
  const groups = new Map<string, Array<Pick<Run, 'id' | 'plannedAt'>>>()
  for (const run of runs) {
    if (!run.driverId) continue
    const day = (run.plannedAt ?? '').slice(0, 10)
    const key = `${run.driverId}|${day}`
    groups.set(key, [...(groups.get(key) ?? []), run])
  }
  const out = new Map<string, { n: number; of: number }>()
  for (const group of groups.values()) {
    group.sort((a, b) => (a.plannedAt ?? '').localeCompare(b.plannedAt ?? '') || a.id.localeCompare(b.id))
    group.forEach((run, i) => out.set(run.id, { n: i + 1, of: group.length }))
  }
  return out
}

/** Which of the three desk tabs a run belongs to, from the run list alone. Completed runs belong to the history. */
export function runTab(run: Pick<Run, 'status' | 'toAttempt' | 'attempts'>): 'assign' | 'active' | 'settle' | 'history' {
  if (run.status === 'planning') return 'assign'
  if (run.status === 'completed') return 'history'
  return (run.toAttempt ?? run.attempts?.active ?? 0) > 0 ? 'active' : 'settle'
}

/** One stop of `GET /fulfillment/delivery-batches/:id`, with the courier's custody state. */
export interface RunStop {
  sequence: number
  shipmentId: string
  orderId?: string
  orderNumber: string | null
  area: string | null
  shipmentStatus: string
  attemptStatus: string
  handedOver: boolean
}

export interface RunDetail {
  id: string
  status: string
  driverId: string | null
  locationId: string | null
  plannedAt: string | null
  dispatchedAt: string | null
  completedAt: string | null
  stops: RunStop[]
}

/** `GET /fulfillment/delivery-batches/:id/settlement` — the server's whole settlement answer for one trip. */
export interface RunSettlementDetail extends RunSettlementSummary {
  runId: string
  runStatus: string
  driverId?: string | null
  completedAt?: string | null
  settlements: Array<{ id: string; reference: string; settledAt: string; expectedTotal: number; countedTotal: number; variance: number }>
  deliveredOrders: Array<{
    orderId: string
    orderNumber: string | null
    cash: { status: string; expectedAmount: number; declaredAmount: number | null; countedAmount: number | null } | null
  }>
  pendingReturns: Array<{ shipmentId: string; orderId: string; orderNumber: string | null; area: string | null }>
}
