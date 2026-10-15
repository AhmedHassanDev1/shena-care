import { ServiceUnavailableException } from '@nestjs/common';
import { deliveryFee } from '../../src/modules/ordering/public';

describe('delivery fee policy (C0 W1)', () => {
  it('uses the provisional fee when the owner has not configured one', () => {
    expect(deliveryFee(undefined)).toBe(50);
    expect(deliveryFee('  ')).toBe(50);
  });

  it('uses the owner-configured fee, including zero and piastres', () => {
    expect(deliveryFee('35')).toBe(35);
    expect(deliveryFee('0')).toBe(0);
    expect(deliveryFee('42.5')).toBe(42.5);
  });

  it('fails closed on an invalid configuration instead of guessing', () => {
    for (const bad of ['-1', 'abc', '10.555', 'Infinity']) {
      expect(() => deliveryFee(bad)).toThrow(ServiceUnavailableException);
    }
  });
});
