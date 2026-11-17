/**
 * Morning / Evening resolution for the routine pages.
 *
 * The default comes from the browser's own clock (so from the customer's local time zone) and never from geolocation.
 * The thresholds are configuration, not magic numbers: change `ROUTINE_PERIOD_CONFIG` or pass another config.
 */

export type RoutinePeriod = 'AM' | 'PM';

export interface PeriodConfig {
  /** Local hour (0–23) at which Morning starts. */
  morningStartHour: number;
  /** Local hour (0–23) at which Evening starts. Morning runs until this hour; Evening wraps past midnight. */
  eveningStartHour: number;
}

/** Morning 06:00–17:59, Evening 18:00–05:59. */
export const ROUTINE_PERIOD_CONFIG: PeriodConfig = { morningStartHour: 6, eveningStartHour: 18 };

export const PERIOD_STORAGE_KEY = 'shina.routines.period';

/** The period a local moment belongs to. `date.getHours()` is the browser-local hour. */
export function resolvePeriod(date: Date, config: PeriodConfig = ROUTINE_PERIOD_CONFIG): RoutinePeriod {
  const hour = date.getHours();
  const { morningStartHour: start, eveningStartHour: end } = config;
  if (start === end) return 'AM';
  const inMorning = start < end ? hour >= start && hour < end : hour >= start || hour < end;
  return inMorning ? 'AM' : 'PM';
}

export const isRoutinePeriod = (value: unknown): value is RoutinePeriod => value === 'AM' || value === 'PM';

/**
 * Initial period on entering a routine page: a choice the customer made earlier in this browser session wins over the
 * clock, so navigating between the three pages never flips what they picked.
 */
export function initialPeriod(stored: string | null | undefined, now: Date, config: PeriodConfig = ROUTINE_PERIOD_CONFIG): RoutinePeriod {
  return isRoutinePeriod(stored) ? stored : resolvePeriod(now, config);
}
