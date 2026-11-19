/**
 * The quantity the operator declares for a line ("how many of these are going in the parcel"). It starts at the full required quantity and is
 * only ever lowered by hand; it is not scan progress, which stays the server's `received`.
 */
export const clampQuantity = (value: number, required: number) => Math.min(Math.max(Math.trunc(Number.isFinite(value) ? value : required), 0), required)

export interface QuantityLine { orderItemId: string; required: number; received: number }

/** Lines where the declared quantity is short of the required one, or where what the server counted differs from the required one. */
export function quantityDifferences<T extends QuantityLine>(lines: T[], quantityOf: (line: T) => number): Array<{ line: T; quantity: number; kind: 'short' | 'scanned-short' | 'excess' }> {
  const out: Array<{ line: T; quantity: number; kind: 'short' | 'scanned-short' | 'excess' }> = []
  for (const line of lines) {
    const quantity = quantityOf(line)
    if (quantity < line.required) out.push({ line, quantity, kind: 'short' })
    else if (line.received > line.required) out.push({ line, quantity, kind: 'excess' })
    else if (line.received < line.required) out.push({ line, quantity, kind: 'scanned-short' })
  }
  return out
}
