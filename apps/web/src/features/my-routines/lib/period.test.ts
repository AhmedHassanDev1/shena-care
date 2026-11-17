import { initialPeriod, MANUAL_CHOICE_TTL_MS, resolvePeriod, ROUTINE_PERIOD_CONFIG, serializeChoice } from './period';

const at = (hour: number, minute = 0) => new Date(2026, 10, 17, hour, minute, 0);

describe('resolvePeriod', () => {
  it('is Morning from 06:00 through 17:59 local time', () => {
    expect(resolvePeriod(at(6, 0))).toBe('AM');
    expect(resolvePeriod(at(12))).toBe('AM');
    expect(resolvePeriod(at(17, 59))).toBe('AM');
  });

  it('is Evening from 18:00 through 05:59, across midnight', () => {
    expect(resolvePeriod(at(18, 0))).toBe('PM');
    expect(resolvePeriod(at(23, 59))).toBe('PM');
    expect(resolvePeriod(at(0, 0))).toBe('PM');
    expect(resolvePeriod(at(5, 59))).toBe('PM');
  });

  it('follows configurable thresholds', () => {
    const config = { morningStartHour: 5, eveningStartHour: 16 };
    expect(resolvePeriod(at(5), config)).toBe('AM');
    expect(resolvePeriod(at(15, 59), config)).toBe('AM');
    expect(resolvePeriod(at(16), config)).toBe('PM');
    expect(resolvePeriod(at(4, 59), config)).toBe('PM');
  });

  it('ships the 06:00 / 18:00 defaults', () => {
    expect(ROUTINE_PERIOD_CONFIG).toEqual({ morningStartHour: 6, eveningStartHour: 18 });
  });
});

describe('initialPeriod', () => {
  const NOW = at(9);
  const pick = (period: 'AM' | 'PM', minutesAgo: number) => serializeChoice(period, NOW.getTime() - minutesAgo * 60_000);

  it('uses the local clock when the customer has not chosen', () => {
    expect(initialPeriod(null, at(9))).toBe('AM');
    expect(initialPeriod(undefined, at(21))).toBe('PM');
  });

  it('keeps a recent manual choice over the clock, so moving between routine pages never flips it', () => {
    expect(initialPeriod(pick('PM', 2), NOW)).toBe('PM');
    const evening = at(21);
    expect(initialPeriod(serializeChoice('AM', evening.getTime() - 10 * 60_000), evening)).toBe('AM');
  });

  it('follows the clock again once the manual choice is older than the TTL', () => {
    expect(initialPeriod(pick('PM', MANUAL_CHOICE_TTL_MS / 60_000 + 1), NOW)).toBe('AM');
  });

  it('ignores corrupt, legacy and future-dated stored values', () => {
    expect(initialPeriod('noon', NOW)).toBe('AM');
    expect(initialPeriod('PM', NOW)).toBe('AM');
    expect(initialPeriod(serializeChoice('PM', NOW.getTime() + 60_000), NOW)).toBe('AM');
  });
});
