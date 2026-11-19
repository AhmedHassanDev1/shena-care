/**
 * The quantity the operator has available for a line ("how many of these are really here"). It starts at the full required quantity and is only
 * lowered by hand; it can never go below what was already received nor above the required quantity. It is not scan progress (`received`, the
 * server's count) and not the original order (`ordered`).
 */
export const clampQuantity = (value: number, received: number, required: number) =>
  Math.min(Math.max(Math.trunc(Number.isFinite(value) ? value : required), received), required)

export interface QuantityLine { orderItemId: string; ordered: number; required: number; received: number; shortage: { missing: number } | null }

export type QuantityDifference = 'shortage-open' | 'adjusted' | 'scanned-short' | 'excess'

/**
 * What differs between the order as placed and what is leaving the Hub, from the server's own numbers: an open shortage report, a line an Admin
 * already reduced, units not counted in, or more counted than required. Used by the handoff warning.
 */
export function quantityDifferences<T extends QuantityLine>(lines: T[]): Array<{ line: T; kind: QuantityDifference }> {
  const out: Array<{ line: T; kind: QuantityDifference }> = []
  for (const line of lines) {
    if (line.shortage) out.push({ line, kind: 'shortage-open' })
    else if (line.received > line.required) out.push({ line, kind: 'excess' })
    else if (line.received < line.required) out.push({ line, kind: 'scanned-short' })
    else if (line.ordered > line.required) out.push({ line, kind: 'adjusted' })
  }
  return out
}
