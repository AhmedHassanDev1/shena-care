/**
 * The quote's distance-based base fee (`deliveryFeeBase`, frozen in the checkout quote) is only an ESTIMATE of what delivering the order costs.
 * Reports use it while no actual courier cost has been recorded and label it estimated; it is never written as if it were an actual cost.
 */
export function quoteDeliveryEstimate(snapshot: unknown): number | null {
  const base = (snapshot as { deliveryFeeBase?: unknown } | null | undefined)?.deliveryFeeBase;
  return typeof base === 'number' && Number.isFinite(base) && base >= 0 ? base : null;
}
