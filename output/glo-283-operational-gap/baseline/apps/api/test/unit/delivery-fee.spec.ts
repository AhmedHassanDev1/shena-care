import { ServiceUnavailableException } from '@nestjs/common';
import { computeDeliveryFee, DEFAULT_DELIVERY_FEE_POLICY, distanceKm, loadDeliveryFeePolicy } from '../../src/modules/ordering/public';

const hub = { latitude: 30, longitude: 31 };
/** A pin roughly `km` kilometres due north of the hub. */
const north = (km: number) => ({ latitude: hub.latitude + km / 111.195, longitude: hub.longitude });

describe('delivery fee policy (owner decision 2026-10-25)', () => {
  const fee = (invoice: number, km?: number) =>
    computeDeliveryFee({ invoice, ...(km === undefined ? {} : north(km)) }, DEFAULT_DELIVERY_FEE_POLICY, hub);

  it('measures straight-line distance from the hub', () => {
    expect(distanceKm(hub, north(10))).toBeCloseTo(10, 1);
  });

  it('prices the base fee by distance band', () => {
    expect(fee(50, 5).fee).toBe(30);
    expect(fee(50, 15).fee).toBe(30);
    expect(fee(50, 15.5).fee).toBe(40);
    expect(fee(50, 29).fee).toBe(40);
    expect(fee(50, 45).fee).toBe(50);
  });

  it('uses the nearest band when the pin is not known yet', () => {
    expect(fee(50).fee).toBe(30);
  });

  it('lets ShinaCare absorb more of the fee as the invoice grows', () => {
    expect(fee(99, 45)).toEqual({ baseFee: 50, discount: 0, fee: 50 });
    expect(fee(100, 45)).toEqual({ baseFee: 50, discount: 5, fee: 45 });
    expect(fee(250, 45).fee).toBe(40);
    expect(fee(450, 45).fee).toBe(30);
  });

  it('never charges below zero and is free from the threshold', () => {
    expect(fee(450, 5).fee).toBe(10);
    expect(fee(499.99, 5).fee).toBe(10);
    expect(fee(500, 45)).toEqual({ baseFee: 50, discount: 50, fee: 0 });
    const tiny = computeDeliveryFee({ invoice: 450 }, { ...DEFAULT_DELIVERY_FEE_POLICY, bands: [{ maxKm: null, fee: 15 }] }, hub);
    expect(tiny.fee).toBe(0);
  });

  it('reads the policy from configuration and fails closed on an invalid one', () => {
    expect(loadDeliveryFeePolicy(undefined)).toEqual(DEFAULT_DELIVERY_FEE_POLICY);
    const custom = { bands: [{ maxKm: null, fee: 25 }], discountTiers: [], freeFrom: 400 };
    expect(loadDeliveryFeePolicy(JSON.stringify(custom))).toEqual(custom);
    for (const bad of ['not json', '{}', JSON.stringify({ ...custom, freeFrom: 0 }), JSON.stringify({ ...custom, bands: [{ maxKm: 10, fee: 25 }] }),
      JSON.stringify({ ...custom, bands: [{ maxKm: 20, fee: 25 }, { maxKm: 10, fee: 30 }, { maxKm: null, fee: 35 }] }),
      JSON.stringify({ ...custom, bands: [{ maxKm: null, fee: -1 }] })]) {
      expect(() => loadDeliveryFeePolicy(bad)).toThrow(ServiceUnavailableException);
    }
  });
});
