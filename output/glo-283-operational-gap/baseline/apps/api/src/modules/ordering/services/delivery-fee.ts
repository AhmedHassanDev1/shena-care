import { ServiceUnavailableException } from '@nestjs/common';
import { getDeliveryHubCoordinates } from './service-area';

/**
 * Customer delivery fee policy (owner decision 2026-10-25): the base fee grows with the straight-line distance from
 * the hub to the customer's confirmed pin; the larger the invoice, the more of the fee ShinaCare absorbs; from a
 * threshold delivery is free. Every number is configuration (DELIVERY_FEE_POLICY, JSON), never code.
 */
export interface DeliveryFeePolicy {
  /** Ascending by distance; the last band has `maxKm: null`. */
  bands: Array<{ maxKm: number | null; fee: number }>;
  /** Largest tier whose `minSubtotal` the invoice reaches is deducted from the base fee (never below zero). */
  discountTiers: Array<{ minSubtotal: number; discount: number }>;
  /** An invoice at or above this amount ships free. */
  freeFrom: number;
}

/** Provisional values from the owner's brief; confirmed or changed through DELIVERY_FEE_POLICY. */
export const DEFAULT_DELIVERY_FEE_POLICY: DeliveryFeePolicy = {
  bands: [{ maxKm: 15, fee: 30 }, { maxKm: 30, fee: 40 }, { maxKm: null, fee: 50 }],
  discountTiers: [
    { minSubtotal: 100, discount: 5 }, { minSubtotal: 200, discount: 10 },
    { minSubtotal: 300, discount: 15 }, { minSubtotal: 400, discount: 20 },
  ],
  freeFrom: 500,
};

const notConfigured = (): never => {
  throw new ServiceUnavailableException({ code: 'DELIVERY_FEE_NOT_CONFIGURED', message: 'Delivery pricing is not configured.' });
};
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Math.round(value * 100) === value * 100;

/** Reads DELIVERY_FEE_POLICY; an invalid value fails closed (no quote) rather than charging a guessed amount. */
export function loadDeliveryFeePolicy(raw = process.env.DELIVERY_FEE_POLICY): DeliveryFeePolicy {
  if (raw === undefined || raw.trim() === '') return DEFAULT_DELIVERY_FEE_POLICY;
  let policy: DeliveryFeePolicy;
  try { policy = JSON.parse(raw); } catch { return notConfigured(); }
  const { bands, discountTiers, freeFrom } = policy ?? ({} as DeliveryFeePolicy);
  if (!Array.isArray(bands) || !bands.length || !Array.isArray(discountTiers) || !money(freeFrom) || freeFrom <= 0) return notConfigured();
  bands.forEach((band, index) => {
    const last = index === bands.length - 1;
    const ordered = index === 0 || (band.maxKm !== null && bands[index - 1].maxKm !== null && band.maxKm > (bands[index - 1].maxKm as number));
    if (!money(band.fee) || (last ? band.maxKm !== null : typeof band.maxKm !== 'number' || band.maxKm <= 0) || (!last && !ordered)) notConfigured();
  });
  discountTiers.forEach(tier => { if (!money(tier.minSubtotal) || !money(tier.discount)) notConfigured(); });
  return policy;
}

/** Great-circle distance in km (no external routing service is used). */
export function distanceKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLng = rad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export interface DeliveryFee {
  /** Fee by distance, before any discount. */
  baseFee: number;
  /** What ShinaCare absorbs: invoice-size discount, or the whole fee when delivery is free. */
  discount: number;
  /** What the customer pays. */
  fee: number;
}

/**
 * `invoice` is the goods total after promotions. Without a pin (a quote asked before the customer placed it) the
 * nearest band applies; checkout recomputes with the confirmed pin and asks the customer to review if the fee moved.
 */
export function computeDeliveryFee(
  input: { invoice: number; latitude?: number | null; longitude?: number | null },
  policy: DeliveryFeePolicy = loadDeliveryFeePolicy(),
  hub = getDeliveryHubCoordinates(),
): DeliveryFee {
  const hasPin = typeof input.latitude === 'number' && typeof input.longitude === 'number';
  const km = hasPin ? distanceKm(hub, { latitude: input.latitude as number, longitude: input.longitude as number }) : 0;
  const band = policy.bands.find(b => b.maxKm === null || km <= b.maxKm) ?? policy.bands[policy.bands.length - 1];
  const baseFee = band.fee;
  const tier = [...policy.discountTiers].sort((a, b) => b.minSubtotal - a.minSubtotal).find(t => input.invoice >= t.minSubtotal);
  const fee = input.invoice >= policy.freeFrom ? 0 : Math.max(0, Math.round((baseFee - (tier?.discount ?? 0)) * 100) / 100);
  return { baseFee, discount: Math.round((baseFee - fee) * 100) / 100, fee };
}
