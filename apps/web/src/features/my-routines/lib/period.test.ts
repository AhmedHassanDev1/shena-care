import { initialPeriod, resolvePeriod, ROUTINE_PERIOD_CONFIG } from './period';

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
  it('uses the clock when the customer has not chosen', () => {
    expect(initialPeriod(null, at(9))).toBe('AM');
    expect(initialPeriod(undefined, at(21))).toBe('PM');
  });

  it('never overrides an earlier manual choice, whatever the clock says', () => {
    expect(initialPeriod('PM', at(9))).toBe('PM');
    expect(initialPeriod('AM', at(21))).toBe('AM');
  });

  it('ignores a corrupt stored value', () => {
    expect(initialPeriod('noon', at(9))).toBe('AM');
  });
});
