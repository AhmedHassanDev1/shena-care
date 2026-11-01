// GLO-280 / GLO-281 — the one supplier-availability policy. PDP, cart, checkout and substitute offers all ask
// SourcingService.getPurchaseAvailability(); ranking and supply planning use the sourcing window below. Nothing else
// may decide "available" on its own.

/** Sourcing (procurement) accepts an available offer whose supplier signal is at most this old; the supplier still
 *  confirms the real quantity on the purchase order, so a week-old signal is a lead, not a promise to a customer. */
export const SOURCING_SIGNAL_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** How long a customer-facing availability signal stays valid (hours, env-configurable, default 24). */
export function customerAvailabilityWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.SUPPLIER_AVAILABILITY_MAX_AGE_HOURS ?? 24);
  if (!Number.isFinite(configured) || configured <= 0 || configured > 720) {
    throw new Error('Invalid supplier availability freshness configuration');
  }
  return configured * 3600000;
}

/**
 * Owner decision (2026-10-25). A supplier file/edit is an availability SIGNAL, never a confirmation. Suppliers keep
 * their quantities current and confirm before preparation, so a signal inside the window is orderable ("PROVISIONAL");
 * the purchase order still confirms the quantity. SUPPLIER_PROVISIONAL_ORDERABLE=false restores confirmed-only ordering.
 */
export function provisionalOrderingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUPPLIER_PROVISIONAL_ORDERABLE !== 'false';
}

/** CONFIRMED: a supplier confirmed within the window. PROVISIONAL: only a feed/edit signal within the window. */
export type PurchaseAvailabilityState = 'CONFIRMED' | 'PROVISIONAL' | 'UNAVAILABLE';

export interface PurchaseAvailability {
  state: PurchaseAvailabilityState;
  /** What every customer-facing surface (PDP, cart, checkout, substitutes) must gate on. */
  orderable: boolean;
  confirmedAt: Date | null;
  observedAt: Date | null;
  validUntil: Date | null;
}

/** Pure: `offers` are the SKU's currently-available offers from active suppliers. */
export function resolvePurchaseAvailability(
  offers: ReadonlyArray<{ lastConfirmedAt: Date | null; lastObservedAt: Date }>,
  at: Date,
  windowMs: number,
  provisionalOrderable: boolean,
): PurchaseAvailability {
  const latest = (dates: Array<Date | null>) => dates
    .filter((d): d is Date => d !== null && d.getTime() <= at.getTime())
    .reduce<Date | null>((best, d) => (best === null || d > best ? d : best), null);
  const confirmedAt = latest(offers.map(o => o.lastConfirmedAt));
  const observedAt = latest(offers.map(o => o.lastObservedAt));
  const fresh = (d: Date | null) => d !== null && d.getTime() + windowMs > at.getTime();

  const state: PurchaseAvailabilityState = fresh(confirmedAt) ? 'CONFIRMED' : fresh(observedAt) ? 'PROVISIONAL' : 'UNAVAILABLE';
  const base = state === 'PROVISIONAL' ? observedAt : confirmedAt;
  return {
    state,
    orderable: state === 'CONFIRMED' || (state === 'PROVISIONAL' && provisionalOrderable),
    confirmedAt,
    observedAt,
    validUntil: base ? new Date(base.getTime() + windowMs) : null,
  };
}
