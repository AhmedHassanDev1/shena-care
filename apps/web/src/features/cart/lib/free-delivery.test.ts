import {
  calculateFreeDeliveryProgress,
  DEFAULT_FREE_DELIVERY_THRESHOLD,
} from './free-delivery';

describe('calculateFreeDeliveryProgress', () => {
  it('has DEFAULT_FREE_DELIVERY_THRESHOLD equal to 500 EGP', () => {
    expect(DEFAULT_FREE_DELIVERY_THRESHOLD).toBe(500);
  });

  it('correctly calculates remaining amount and percentage below threshold', () => {
    const result = calculateFreeDeliveryProgress(130, 500);
    expect(result.threshold).toBe(500);
    expect(result.remaining).toBe(370);
    expect(result.progressPct).toBe(26);
    expect(result.reached).toBe(false);
  });

  it('correctly reports reached state at exact threshold', () => {
    const result = calculateFreeDeliveryProgress(500, 500);
    expect(result.remaining).toBe(0);
    expect(result.progressPct).toBe(100);
    expect(result.reached).toBe(true);
  });

  it('clamps progress to 100% and remaining to 0 when exceeding threshold', () => {
    const result = calculateFreeDeliveryProgress(750, 500);
    expect(result.remaining).toBe(0);
    expect(result.progressPct).toBe(100);
    expect(result.reached).toBe(true);
  });

  it('handles zero or negative totals gracefully', () => {
    const resultZero = calculateFreeDeliveryProgress(0, 500);
    expect(resultZero.remaining).toBe(500);
    expect(resultZero.progressPct).toBe(0);
    expect(resultZero.reached).toBe(false);

    const resultNegative = calculateFreeDeliveryProgress(-50, 500);
    expect(resultNegative.remaining).toBe(500);
    expect(resultNegative.progressPct).toBe(0);
    expect(resultNegative.reached).toBe(false);
  });

  it('supports custom threshold overrides', () => {
    const result = calculateFreeDeliveryProgress(300, 600);
    expect(result.threshold).toBe(600);
    expect(result.remaining).toBe(300);
    expect(result.progressPct).toBe(50);
    expect(result.reached).toBe(false);
  });
});
